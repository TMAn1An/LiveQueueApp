import type { Counter, Prisma, QueueFormField, Token, TokenStatus } from '@prisma/client';
import { z, type ZodTypeAny } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertValidTransition } from '../utils/tokenStateMachine';
import { findCounterScoped } from './counter.service';
import { requireOwnedQueue } from '../utils/tenantScope';
import { registerDevice } from './device.service';
import type { AuthContext } from '../utils/authContext';
import {
  computeEffectiveDurationMinutes,
  computeEffectiveEndTime,
  minutesUntil,
  simulateWaitingTokenEtas,
  type CounterOccupancy,
  type WaitingTokenInput,
} from './queueEtaEngine';

const QUEUE_ARCHIVED_MSG = 'This queue has been archived and can no longer accept new tokens.';
const QUEUE_NOT_ACTIVE_MSG = 'This queue is currently not accepting new customers.';

export interface CreateTokenInput {
  queueId: string;
  /// V2 Checkpoint 5 (ADR-027): the validator canonicalizes both the legacy
  /// `serviceId` and the new `serviceIds` request shapes into this one array
  /// (already deduplicated, length >= 1) before this ever runs.
  serviceIds: string[];
  deviceIdentifier: string;
  formData: Record<string, unknown>;
}

/** The shape every idempotency comparison needs — the existing token's full
 * selected-service set, not just its legacy primary Token.serviceId. */
type TokenWithServices = Token & { tokenServices: { serviceId: string }[] };

interface QueueLockRow {
  id: string;
  nextTokenNumber: number;
  formVersion: number;
  status: string;
  deletedAt: Date | null;
  tokenPrefix: string;
  organizationId: string;
}

/**
 * token → organizationId directly (Token carries its own organizationId,
 * denormalized at creation from queue.organizationId) — never authorize
 * using tokenId alone (CLAUDE.md Rule 4).
 */
async function findTokenScoped(organizationId: string, tokenId: string): Promise<Token> {
  const token = await prisma.token.findFirst({ where: { id: tokenId, organizationId } });
  if (!token) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }
  return token;
}

/**
 * V2 Checkpoint 5 (ADR-027): a token's base required duration is the sum of
 * every selected service's own durationMinutes — the backend-authoritative
 * replacement for the single-service duration the ETA engine previously
 * received directly. Never trusts a client-supplied total; always derived
 * fresh from the DB rows.
 */
function sumServiceDurations(tokenServices: { service: { durationMinutes: number } }[]): number {
  return tokenServices.reduce((sum, ts) => sum + ts.service.durationMinutes, 0);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
    );
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) =>
        deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
      )
    );
  }
  return false;
}

/**
 * Dynamic per-queue validation built from the current QueueFormField rows —
 * there is no static schema for form data, since it's entirely operator
 * defined (spec section 7.6 / 9).
 *
 * The non-empty constraint (`.min(1)` / enum membership) is applied only
 * when the field is actually required — an optional field accepts either an
 * omitted key or an empty string as "no answer," not just an omitted key.
 * Real form clients (web and mobile) commonly submit "" for a blank optional
 * input rather than dropping the key entirely.
 */
function buildFieldSchema(field: QueueFormField): ZodTypeAny {
  switch (field.type) {
    case 'number':
      return field.required ? z.number() : z.number().optional();
    case 'checkbox':
      return field.required ? z.boolean() : z.boolean().optional();
    case 'dropdown':
    case 'radio':
      if (field.options.length > 0) {
        const enumSchema = z.enum(field.options as [string, ...string[]]);
        return field.required ? enumSchema : z.union([enumSchema, z.literal('')]).optional();
      }
      return field.required ? z.string().trim().min(1) : z.string().trim().optional();
    default:
      return field.required ? z.string().trim().min(1) : z.string().trim().optional();
  }
}

function buildFormDataSchema(fields: QueueFormField[]) {
  const shape: Record<string, ZodTypeAny> = {};

  for (const field of fields) {
    shape[field.key] = buildFieldSchema(field);
  }

  return z.object(shape).strict();
}

function validateFormData(
  fields: QueueFormField[],
  formData: Record<string, unknown>,
): Record<string, unknown> {
  const schema = buildFormDataSchema(fields);
  const result = schema.safeParse(formData);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new AppError(422, 'VALIDATION_ERROR', message || 'Invalid form data.');
  }
  return result.data as Record<string, unknown>;
}

/**
 * V2 Checkpoint 5 (ADR-027): the same idempotency key must resolve to the
 * existing token only when it represents the same *set* of services —
 * order must never matter ([A,B] === [B,A]), but the actual set must
 * ([A,B] !== [A,C]). Canonicalized by sorting both sides rather than
 * trusting array order from either the stored rows or the new request.
 */
function assertIdempotentPayloadMatches(
  existing: TokenWithServices,
  input: CreateTokenInput,
  validatedFormData: Record<string, unknown>,
): void {
  const existingServiceIds = existing.tokenServices.map((ts) => ts.serviceId).sort();
  const inputServiceIds = [...input.serviceIds].sort();
  const sameServices =
    existingServiceIds.length === inputServiceIds.length &&
    existingServiceIds.every((id, i) => id === inputServiceIds[i]);

  const same = existing.queueId === input.queueId && sameServices && deepEqual(existing.formData, validatedFormData);

  if (!same) {
    throw new AppError(
      409,
      'IDEMPOTENCY_KEY_CONFLICT',
      'This idempotency key was already used with different request data.',
    );
  }
}

/**
 * Token creation, per approved Phase 3 decisions 1-4 and 13-14. Everything
 * that can independently fail is validated before the queue row is locked;
 * the lock + sequence increment + insert are the last steps, so a failed
 * transaction never leaves next_token_number advanced (ADR-003).
 */
export async function createToken(input: CreateTokenInput, idempotencyKey: string) {
  const queue = await prisma.queue.findUnique({ where: { id: input.queueId } });
  if (!queue) {
    throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
  }
  if (queue.deletedAt) {
    throw new AppError(409, 'QUEUE_ARCHIVED', QUEUE_ARCHIVED_MSG);
  }
  if (queue.status !== 'ACTIVE') {
    throw new AppError(409, 'QUEUE_NOT_ACTIVE', QUEUE_NOT_ACTIVE_MSG);
  }

  // V2 Checkpoint 5 (ADR-027): every selected service must belong to this
  // exact queue and be active — checked as a set, never trusting a
  // client-supplied duration or count. `services.length !== serviceIds.length`
  // catches both "doesn't exist at all" and "belongs to a different queue"
  // in one comparison, matching the existing single-service 404 semantics.
  const services = await prisma.queueService.findMany({
    where: { id: { in: input.serviceIds }, queueId: input.queueId },
  });
  if (services.length !== input.serviceIds.length) {
    throw new AppError(404, 'SERVICE_NOT_FOUND', 'One or more selected services could not be found.');
  }
  if (services.some((s) => !s.isActive)) {
    throw new AppError(409, 'SERVICE_NOT_ACTIVE', 'One or more selected services are not currently available.');
  }

  const device = await registerDevice(input.deviceIdentifier);
  // OrganizationDeviceBlock, not device.status, is authoritative — a device
  // can be blocked by one organization without affecting any other
  // (organizationId here comes from the already-resolved queue, never from
  // the customer request).
  const block = await prisma.organizationDeviceBlock.findUnique({
    where: { organizationId_deviceId: { organizationId: queue.organizationId, deviceId: device.id } },
  });
  if (block) {
    throw new AppError(403, 'DEVICE_BLOCKED', 'This device has been blocked.');
  }

  const formFields = await prisma.queueFormField.findMany({
    where: { queueId: input.queueId, version: queue.formVersion },
  });
  const formData = validateFormData(formFields, input.formData);

  // Fast pre-lock idempotency check — a pure optimization to avoid
  // contending for the queue lock on a known-duplicate request. The
  // authoritative check happens again below, inside the transaction.
  const preCheck = await prisma.token.findUnique({
    where: { deviceId_idempotencyKey: { deviceId: device.id, idempotencyKey } },
    include: { tokenServices: { select: { serviceId: true } } },
  });
  if (preCheck) {
    assertIdempotentPayloadMatches(preCheck, input, formData);
    return getTokenCustomerView(preCheck.id);
  }

  const created = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<QueueLockRow[]>`
      SELECT id, next_token_number AS "nextTokenNumber", form_version AS "formVersion",
             status, deleted_at AS "deletedAt", token_prefix AS "tokenPrefix",
             organization_id AS "organizationId"
      FROM queues WHERE id = ${input.queueId} FOR UPDATE
    `;
    const lockedQueue = rows[0];
    if (!lockedQueue) {
      throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
    }
    // Re-verified against the freshly-locked row (not the pre-lock read
    // above) to close the TOCTOU window between validation and the lock —
    // e.g. staff pausing the queue in between.
    if (lockedQueue.deletedAt) {
      throw new AppError(409, 'QUEUE_ARCHIVED', QUEUE_ARCHIVED_MSG);
    }
    if (lockedQueue.status !== 'ACTIVE') {
      throw new AppError(409, 'QUEUE_NOT_ACTIVE', QUEUE_NOT_ACTIVE_MSG);
    }

    // Authoritative idempotency re-check, taken while holding the queue
    // lock. This ordering — lock first, then check — is what prevents a
    // concurrent duplicate-key request from consuming a sequence number
    // that no token ends up using (no gaps under a duplicate-key race).
    const existing = await tx.token.findUnique({
      where: { deviceId_idempotencyKey: { deviceId: device.id, idempotencyKey } },
      include: { tokenServices: { select: { serviceId: true } } },
    });
    if (existing) {
      assertIdempotentPayloadMatches(existing, input, formData);
      return existing;
    }

    // One device may hold at most one non-terminal-for-this-rule token per
    // queue at a time (approved design). Scoped by (deviceId, queueId) only
    // — queueId already determines organizationId, so adding it would be
    // redundant. SKIPPED is deliberately excluded from the blocking set even
    // though it isn't graph-terminal (SKIPPED -> CALLED via Recall exists) —
    // the approved rule frees the slot immediately on skip; see the matching
    // guard in callToken's recall path for the resulting Recall interaction.
    // Checked under the queue row lock acquired above, so this is race-free
    // against another concurrent createToken call for the same queue —
    // backed by a DB partial unique index (tokens_device_queue_active_key)
    // as a defense-in-depth backstop.
    const existingActive = await tx.token.findFirst({
      where: {
        deviceId: device.id,
        queueId: input.queueId,
        status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] },
      },
    });
    if (existingActive) {
      throw new AppError(
        409,
        'DEVICE_ALREADY_IN_QUEUE',
        'This device already has an active token in this queue.',
      );
    }

    const sequenceNumber = lockedQueue.nextTokenNumber;
    await tx.queue.update({
      where: { id: input.queueId },
      data: { nextTokenNumber: sequenceNumber + 1 },
    });

    // V2 Checkpoint 5 (ADR-027): the legacy Token.serviceId column is kept
    // populated — the first service in the customer's selection — so any
    // code path still reading it directly (including an old, not-yet-
    // updated mobile app parsing this same token's future responses) keeps
    // working. tokenServices is the authoritative full set, created
    // atomically with the token itself in this same transaction/statement.
    return tx.token.create({
      data: {
        organizationId: lockedQueue.organizationId,
        queueId: input.queueId,
        serviceId: input.serviceIds[0]!,
        deviceId: device.id,
        sequenceNumber,
        serialNumber: `${lockedQueue.tokenPrefix}${String(sequenceNumber).padStart(3, '0')}`,
        status: 'WAITING',
        formData: formData as Prisma.InputJsonValue,
        formVersion: lockedQueue.formVersion,
        idempotencyKey,
        tokenServices: { create: input.serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });
  });

  return getTokenCustomerView(created.id);
}

interface QueueEtaEntry {
  id: string;
  organizationId: string;
  queueId: string;
  sequenceNumber: number;
  position: number;
  estimatedWaitMinutes: number | null;
  estimatedReadyAt: Date | null;
}

/**
 * V2 Checkpoint 4 (ADR-026): the shared core behind both
 * computeComputedFields (single token) and listWaitingTokenPositions
 * (queue-wide batch, used by the realtime layer) — a real multi-counter
 * FCFS scheduling simulation (queueEtaEngine.ts), not the old
 * `duration × position / counters` approximation. Always simulates every
 * currently-WAITING token in the queue at once (there's no way to
 * correctly answer "when will token X be called" without knowing the state
 * of every active counter and everyone ahead of it) — queue sizes in a
 * live queue-management system are small, so this stays cheap.
 *
 * `now` is a parameter (not read internally) purely so tests can pin it;
 * every real call site uses the default.
 */
async function computeQueueEtas(queueId: string, now: Date = new Date()): Promise<QueueEtaEntry[]> {
  const [activeCounters, waitingTokens] = await Promise.all([
    prisma.counter.findMany({
      where: { queueId, status: 'ACTIVE' },
      include: {
        // At most one match per counter, by the existing busy-check
        // invariant (callToken/nextToken never let two CALLED/IN_PROGRESS
        // tokens share a counter) — never trusted as a hard guarantee here,
        // just how the data is actually shaped.
        tokens: {
          where: { status: { in: ['CALLED', 'IN_PROGRESS'] } },
          include: { tokenServices: { include: { service: true } } },
        },
      },
    }),
    prisma.token.findMany({
      where: { queueId, status: 'WAITING' },
      orderBy: { sequenceNumber: 'asc' },
      include: { tokenServices: { include: { service: true } } },
    }),
  ]);

  if (activeCounters.length === 0) {
    // No meaningful denominator — an estimate here would imply active
    // service that isn't happening (approved product decision, carried
    // forward unchanged from the pre-Checkpoint-4 design).
    return waitingTokens.map((token, index) => ({
      id: token.id,
      organizationId: token.organizationId,
      queueId: token.queueId,
      sequenceNumber: token.sequenceNumber,
      position: index + 1,
      estimatedWaitMinutes: null,
      estimatedReadyAt: null,
    }));
  }

  const counterOccupancy: CounterOccupancy[] = activeCounters.map((counter) => {
    const occupying = counter.tokens[0];
    if (!occupying) {
      return { freeAt: now };
    }
    // V2 Checkpoint 5 (ADR-027): the base (pre-override) duration is now
    // the sum of every selected service's own duration, not one service's
    // — the staff override, when set, still fully replaces this rather
    // than adding to it (computeEffectiveDurationMinutes's existing
    // either/or logic, unchanged).
    const durationMinutes = computeEffectiveDurationMinutes(
      occupying.requiredDurationMinutes,
      sumServiceDurations(occupying.tokenServices),
    );
    // IN_PROGRESS anchors from when service actually began (startedAt);
    // CALLED-but-not-yet-started anchors from calledAt as the best
    // available approximation of "about to start."
    const anchor = occupying.startedAt ?? occupying.calledAt ?? now;
    return { freeAt: computeEffectiveEndTime(anchor, durationMinutes, now) };
  });

  const waitingInputs: WaitingTokenInput[] = waitingTokens.map((token) => ({
    id: token.id,
    durationMinutes: sumServiceDurations(token.tokenServices),
  }));

  const etaByTokenId = simulateWaitingTokenEtas(counterOccupancy, waitingInputs);

  return waitingTokens.map((token, index) => {
    const estimatedReadyAt = etaByTokenId.get(token.id) ?? null;
    return {
      id: token.id,
      organizationId: token.organizationId,
      queueId: token.queueId,
      sequenceNumber: token.sequenceNumber,
      position: index + 1,
      estimatedWaitMinutes: estimatedReadyAt ? minutesUntil(estimatedReadyAt, now) : null,
      estimatedReadyAt,
    };
  });
}

async function computeComputedFields(
  token: Token,
): Promise<{ position: number | null; estimatedWaitMinutes: number | null; estimatedReadyAt: Date | null }> {
  if (token.status !== 'WAITING') {
    return { position: null, estimatedWaitMinutes: null, estimatedReadyAt: null };
  }

  const entries = await computeQueueEtas(token.queueId);
  const entry = entries.find((e) => e.id === token.id);
  return entry
    ? {
        position: entry.position,
        estimatedWaitMinutes: entry.estimatedWaitMinutes,
        estimatedReadyAt: entry.estimatedReadyAt,
      }
    : { position: null, estimatedWaitMinutes: null, estimatedReadyAt: null };
}

/**
 * Batch equivalent of computeComputedFields, for every currently-WAITING
 * token in one queue at once — used by the realtime layer to recompute
 * ETAs after anything that could shift them (approved Phase 4 decision 4,
 * broadened in V2 Checkpoint 4: not just a token leaving WAITING, but any
 * change to counter occupancy — call/start/complete/skip/recall/a staff
 * duration override — since every WAITING token's ETA now depends on the
 * state of every active counter, not just its own position).
 */
export async function listWaitingTokenPositions(queueId: string): Promise<QueueEtaEntry[]> {
  return computeQueueEtas(queueId);
}

/**
 * Customer-safe view (approved decision 8): no organizationId, deviceId,
 * idempotencyKey, or formVersion — only what the customer needs to track
 * their own token, plus which counter to go to once called.
 */
type ComputedFields = {
  position: number | null;
  estimatedWaitMinutes: number | null;
  /** V2 Checkpoint 4: server-authoritative anchor for the mobile live
   * countdown — the client ticks locally against this timestamp and
   * re-anchors whenever a fresh one arrives, never treating its own clock
   * as authoritative (Rule F). */
  estimatedReadyAt: Date | null;
};

interface SelectedService {
  id: string;
  name: string;
  durationMinutes: number;
}

/** Deterministic order (the queue's own service-menu order), not insertion
 * order into the join table — every response that lists a token's selected
 * services shows them the same way regardless of how they were submitted. */
type TokenWithSelectedServices = { tokenServices: { service: { id: string; serviceName: string; durationMinutes: number; createdAt: Date } }[] };

function toSelectedServices(token: TokenWithSelectedServices): SelectedService[] {
  return [...token.tokenServices]
    .sort((a, b) => a.service.createdAt.getTime() - b.service.createdAt.getTime())
    .map((ts) => ({ id: ts.service.id, name: ts.service.serviceName, durationMinutes: ts.service.durationMinutes }));
}

const TOKEN_SERVICES_INCLUDE = {
  tokenServices: { include: { service: { select: { id: true, serviceName: true, durationMinutes: true, createdAt: true } } } },
} satisfies Prisma.TokenInclude;

function toCustomerView(
  token: Token & { counter?: Counter | null } & TokenWithSelectedServices,
  computed: ComputedFields,
) {
  return {
    id: token.id,
    queueId: token.queueId,
    /// LEGACY — the first selected service, kept for an old mobile client
    /// still parsing this field directly (V2 Checkpoint 5, ADR-027).
    serviceId: token.serviceId,
    /// The authoritative, complete selection. New clients should read this.
    services: toSelectedServices(token),
    serialNumber: token.serialNumber,
    status: token.status,
    formData: token.formData,
    position: computed.position,
    estimatedWaitMinutes: computed.estimatedWaitMinutes,
    estimatedReadyAt: computed.estimatedReadyAt,
    counter: token.counter ? { id: token.counter.id, name: token.counter.name } : null,
    createdAt: token.createdAt,
    calledAt: token.calledAt,
    startedAt: token.startedAt,
    completedAt: token.completedAt,
    skippedAt: token.skippedAt,
  };
}

function toStaffView(
  token: Token & { counter?: Counter | null } & TokenWithSelectedServices,
  computed: ComputedFields,
) {
  return { ...token, services: toSelectedServices(token), ...computed };
}

/**
 * The exact customer-safe shape (approved decision 8) — reused by the REST
 * response and by the realtime layer's token:{id} room payloads, so "what's
 * safe to show a customer" stays defined in exactly one place.
 */
export async function getTokenCustomerView(tokenId: string) {
  const token = await prisma.token.findUniqueOrThrow({
    where: { id: tokenId },
    include: { counter: true, ...TOKEN_SERVICES_INCLUDE },
  });
  const computed = await computeComputedFields(token);
  return toCustomerView(token, computed);
}

/**
 * Full staff-authorized shape — used by the realtime layer's
 * organization:{id} room payloads (approved decision 2/5). Callers are
 * responsible for having already established the recipient is staff of the
 * owning organization (room-join authorization already does this); this
 * function itself does not re-check organization membership.
 */
export async function getTokenStaffView(tokenId: string) {
  const token = await prisma.token.findUniqueOrThrow({
    where: { id: tokenId },
    include: { counter: true, ...TOKEN_SERVICES_INCLUDE },
  });
  const computed = await computeComputedFields(token);
  return toStaffView(token, computed);
}

/**
 * Staff (matching organization) get the full record; anyone else — an
 * anonymous customer, or staff of a different organization — gets the
 * customer-safe view. The customer view is safe to return to literally
 * anyone who knows the token's (high-entropy) id, per approved decision 8.
 */
export async function getToken(tokenId: string, auth?: AuthContext) {
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: { counter: true, ...TOKEN_SERVICES_INCLUDE },
  });
  if (!token) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }

  const computed = await computeComputedFields(token);

  if (auth && auth.organizationId === token.organizationId) {
    return toStaffView(token, computed);
  }
  return toCustomerView(token, computed);
}

export async function getTokenStatus(tokenId: string) {
  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }
  const computed = await computeComputedFields(token);
  return { id: token.id, status: token.status, ...computed };
}

/**
 * counterId must belong to the same organization AND the same queue as the
 * token (CLAUDE.md Rule 4 — never authorize via a child id alone). The
 * counter row is locked (FOR UPDATE) for the busy/active check; the token
 * update is a conditional (compare-and-swap) UPDATE on status, which is the
 * "lock the token row appropriately" step — Postgres implicitly locks the
 * row for the duration of that UPDATE statement.
 *
 * Shared by both /call (WAITING -> CALLED) and /recall (SKIPPED -> CALLED —
 * see tokenStateMachine.ts) — the mechanics are identical, and reusing this
 * exact function is what keeps recall safe: a token skipped from
 * CALLED/IN_PROGRESS keeps its old counterId (skipToken never clears it),
 * but this function always re-verifies the target counter fresh and
 * unconditionally overwrites counterId, so a stale prior assignment can
 * never leak into an invalid double-served-counter state.
 *
 * `requireSourceStatus` narrows the otherwise-generic
 * assertValidTransition(token.status, 'CALLED') check to exactly the source
 * status the calling endpoint means to represent — WAITING: [CALLED] and
 * SKIPPED: [CALLED] are both valid *transitions*, but /call and /recall are
 * deliberately distinct *operations* (different audit action, different
 * product meaning), so each must reject the other's source state rather
 * than silently accepting it just because the table permits it generically.
 */
export async function callToken(
  organizationId: string,
  tokenId: string,
  counterId: string,
  requireSourceStatus: 'WAITING' | 'SKIPPED',
) {
  const token = await findTokenScoped(organizationId, tokenId);
  const counter = await findCounterScoped(organizationId, counterId);

  if (counter.queueId !== token.queueId) {
    throw new AppError(409, 'COUNTER_QUEUE_MISMATCH', "Counter does not belong to the token's queue.");
  }

  if (token.status !== requireSourceStatus) {
    throw new AppError(
      422,
      'INVALID_TOKEN_TRANSITION',
      `Cannot transition token from ${token.status} to CALLED.`,
    );
  }
  assertValidTransition(token.status, 'CALLED');

  // Recall-only guard (approved design, Option A): skipping a token frees
  // its device+queue slot immediately, so the device may have gone on to
  // create a brand new active token in this same queue in the meantime.
  // Recalling the old skipped token would then produce two active tokens
  // for the same device in the same queue — reject it instead. Not needed
  // on the plain /call (WAITING) path: the one-active-token-per-device-per-
  // queue invariant already guarantees a WAITING token has no other active
  // sibling to conflict with. The DB partial unique index
  // (tokens_device_queue_active_key) remains the authoritative backstop for
  // the narrow race window this pre-check doesn't fully close (this
  // function holds no lock analogous to createToken's queue-row lock).
  if (requireSourceStatus === 'SKIPPED') {
    const conflicting = await prisma.token.findFirst({
      where: {
        deviceId: token.deviceId,
        queueId: token.queueId,
        status: { in: ['WAITING', 'CALLED', 'IN_PROGRESS'] },
        id: { not: tokenId },
      },
    });
    if (conflicting) {
      throw new AppError(
        409,
        'DEVICE_ALREADY_IN_QUEUE',
        'This device already has another active token in this queue; recall is not allowed.',
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const counterRows = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM counters WHERE id = ${counterId} FOR UPDATE
    `;
    const lockedCounter = counterRows[0];
    if (!lockedCounter || lockedCounter.status !== 'ACTIVE') {
      throw new AppError(409, 'COUNTER_NOT_AVAILABLE', 'Counter is not active.');
    }

    // V2 Checkpoint 3 (ADR-025): strict FCFS, WAITING path only — a manually
    // chosen tokenId must be the earliest WAITING token in its queue, or
    // staff could bypass arrival order entirely (the exact V1 gap this
    // checkpoint closes). Recall (SKIPPED -> CALLED) is deliberately exempt:
    // a skipped token isn't WAITING, so it can never be "out of order" among
    // waiting tokens — its own capacity constraint is the counter-busy check
    // below, shared with this same path.
    //
    // A plain (non-locking) EXISTS read is sufficient here, not a race: a
    // token's sequenceNumber is assigned once at creation and never reused,
    // and nothing in the state machine transitions a token back *into*
    // WAITING (SKIPPED -> CALLED goes straight to CALLED). So the set of
    // "WAITING tokens with a smaller sequence number than this one" can only
    // ever shrink over time, never gain a new, smaller member after this
    // check runs — there is no window in which a concurrent transaction can
    // turn a true "no earlier token" result into a false one before this
    // transaction's own compare-and-swap UPDATE commits.
    if (requireSourceStatus === 'WAITING') {
      const earlierWaitingRows = await tx.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM tokens
          WHERE queue_id = ${token.queueId}
            AND status = 'WAITING'
            AND sequence_number < ${token.sequenceNumber}
        ) AS "exists"
      `;
      if (earlierWaitingRows[0]?.exists) {
        throw new AppError(
          409,
          'FCFS_VIOLATION',
          'An earlier customer is still waiting. The earliest eligible customer must be called first.',
        );
      }
    }

    // Excludes this same tokenId: without it, two racing requests for the
    // *same already-CALLED-then-skipped* token/counter pair (only possible
    // via recall — a fresh WAITING token could never already occupy this
    // counter) would have the loser misread its own winning twin's
    // just-committed row as "a different token is busy" instead of
    // correctly falling through to the TOKEN_STATE_CHANGED check below. This
    // same check is what bounds Recall to available counter capacity
    // (checkpoint requirement 7) — recall shares this exact function, so a
    // busy counter rejects a recall attempt identically to a normal call.
    const busy = await tx.token.findFirst({
      where: { counterId, status: { in: ['CALLED', 'IN_PROGRESS'] }, id: { not: tokenId } },
    });
    if (busy) {
      throw new AppError(409, 'COUNTER_NOT_AVAILABLE', 'Counter is already serving another token.');
    }

    const result = await tx.token.updateMany({
      where: { id: tokenId, status: token.status },
      data: { status: 'CALLED', counterId, calledAt: new Date() },
    });
    if (result.count === 0) {
      throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
    }

    return tx.token.findUniqueOrThrow({ where: { id: tokenId } });
  });
}

type TimestampField = 'startedAt' | 'completedAt' | 'skippedAt';

/**
 * Shared implementation for the three counter-independent transitions.
 * Loads current state, validates the transition centrally, then applies a
 * conditional (compare-and-swap) UPDATE as the concurrency-safety net —
 * two racing requests against the same token can only have one succeed.
 *
 * Returns `previousStatus` alongside the updated token: the realtime layer
 * needs it to decide whether a WAITING->SKIPPED transition (which affects
 * other waiting tokens' positions) actually happened, versus a
 * CALLED/IN_PROGRESS->SKIPPED transition (which doesn't) — see
 * token.controller.ts `skip` (approved Phase 4 decision 4).
 */
async function transitionToken(
  organizationId: string,
  tokenId: string,
  targetStatus: TokenStatus,
  timestampField: TimestampField,
): Promise<{ token: Token; previousStatus: TokenStatus }> {
  const token = await findTokenScoped(organizationId, tokenId);
  assertValidTransition(token.status, targetStatus);
  const previousStatus = token.status;

  const result = await prisma.token.updateMany({
    where: { id: tokenId, status: token.status },
    data: { status: targetStatus, [timestampField]: new Date() },
  });
  if (result.count === 0) {
    throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
  }

  const updated = await prisma.token.findUniqueOrThrow({ where: { id: tokenId } });
  return { token: updated, previousStatus };
}

export const startToken = (organizationId: string, tokenId: string) =>
  transitionToken(organizationId, tokenId, 'IN_PROGRESS', 'startedAt');

export const completeToken = (organizationId: string, tokenId: string) =>
  transitionToken(organizationId, tokenId, 'COMPLETED', 'completedAt');

export const skipToken = (organizationId: string, tokenId: string) =>
  transitionToken(organizationId, tokenId, 'SKIPPED', 'skippedAt');

/**
 * Auto-selects the oldest eligible WAITING token for the given counter
 * (approved decision 3 — staff selects the counter, not the token).
 * Archived-queue guard is deliberately NOT applied here (approved decision
 * 11): archival stops new intake but must not strand tokens already in the
 * queue.
 */
export async function nextToken(organizationId: string, queueId: string, counterId: string) {
  await requireOwnedQueue(organizationId, queueId);
  const counter = await findCounterScoped(organizationId, counterId);

  if (counter.queueId !== queueId) {
    throw new AppError(409, 'COUNTER_QUEUE_MISMATCH', 'Counter does not belong to this queue.');
  }

  return prisma.$transaction(async (tx) => {
    const counterRows = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM counters WHERE id = ${counterId} FOR UPDATE
    `;
    const lockedCounter = counterRows[0];
    if (!lockedCounter || lockedCounter.status !== 'ACTIVE') {
      throw new AppError(409, 'COUNTER_NOT_AVAILABLE', 'Counter is not active.');
    }

    const busy = await tx.token.findFirst({
      where: { counterId, status: { in: ['CALLED', 'IN_PROGRESS'] } },
    });
    if (busy) {
      throw new AppError(409, 'COUNTER_NOT_AVAILABLE', 'Counter is already serving another token.');
    }

    // SKIP LOCKED (approved decision 5, scoped only to this selection query
    // — not the sequence-allocation lock in createToken) lets two counters
    // calling /next concurrently claim two different waiting tokens without
    // blocking on each other.
    const eligibleRows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tokens
      WHERE queue_id = ${queueId} AND status = 'WAITING'
      ORDER BY sequence_number ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const eligible = eligibleRows[0];
    if (!eligible) {
      throw new AppError(404, 'NO_ELIGIBLE_TOKENS', 'No eligible waiting tokens.');
    }

    return tx.token.update({
      where: { id: eligible.id },
      data: { status: 'CALLED', counterId, calledAt: new Date() },
    });
  });
}

/**
 * V2 Checkpoint 4 (ADR-026): staff override of a currently-active
 * customer's required service duration. Restricted to CALLED/IN_PROGRESS
 * ("an active customer," per the product requirement) — a WAITING or
 * terminal-state token has no occupancy for this to meaningfully affect,
 * and allowing it there would let the field silently accumulate stale
 * values with no relationship to an actual in-progress service. This
 * itself is not a state-machine transition (status is untouched), so it
 * doesn't go through assertValidTransition/transitionToken.
 */
export async function setRequiredDuration(
  organizationId: string,
  tokenId: string,
  requiredDurationMinutes: number,
): Promise<Token> {
  const token = await findTokenScoped(organizationId, tokenId);

  if (token.status !== 'CALLED' && token.status !== 'IN_PROGRESS') {
    throw new AppError(
      409,
      'TOKEN_NOT_ACTIVE',
      'Required duration can only be set for a currently CALLED or IN_PROGRESS customer.',
    );
  }

  return prisma.token.update({
    where: { id: tokenId },
    data: { requiredDurationMinutes },
  });
}

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
  decryptOtpCode,
  encryptOtpCode,
  generateOtpCode,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_FAILED_ATTEMPTS,
  verifyOtpCode,
} from '../utils/otp';
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
  /** V2 Checkpoint 6 — read under the same row lock as the active-token
   * check below, so both checks are race-free against the same lock. */
  allowRepeatVisits: boolean;
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

const OTP_FIELD_NAMES = [
  'serviceStartOtpCipher',
  'serviceStartOtpExpiresAt',
  'serviceStartOtpFailedAttempts',
] as const;

/**
 * V2 Checkpoint 7: the verification-code cipher/expiry/attempt-count are
 * customer-only-adjacent internal state — they must NEVER reach a staff or
 * customer serialization (REST response, socket payload, FCM payload, audit
 * metadata). Every function in this file that returns a raw Token object
 * (as opposed to the explicit-whitelist toCustomerView) routes its final
 * return through this, so no call site has to remember to strip them
 * individually — centralizing this once here is what makes the "search
 * every serialization path" security review in ADR-029 actually verifiable.
 */
function omitOtpFields<T extends Record<string, unknown>>(
  token: T,
): Omit<T, (typeof OTP_FIELD_NAMES)[number]> {
  const safe = { ...token };
  for (const field of OTP_FIELD_NAMES) {
    delete safe[field];
  }
  return safe;
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
  // V2 Checkpoint 6: a static queue-configuration gate, not a resource
  // allocation — needs no transactional lock (unlike the checks below).
  // The legacy singular `serviceId` shape already normalizes to a
  // 1-element serviceIds array, so it always satisfies this unchanged.
  if (!queue.allowMultipleServices && input.serviceIds.length !== 1) {
    throw new AppError(
      409,
      'MULTIPLE_SERVICES_NOT_ALLOWED',
      'This queue only allows selecting a single service.',
    );
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
             organization_id AS "organizationId", allow_repeat_visits AS "allowRepeatVisits"
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

    // V2 Checkpoint 6: a separate, independent rule from the active-token
    // check above — one device may complete a queue's service at most once
    // when allowRepeatVisits is false. SKIPPED deliberately does NOT count
    // (only COMPLETED does): a device with just a SKIPPED token has never
    // actually been served and must still be allowed to (re)join. Recall
    // (SKIPPED -> CALLED) reuses the same token row rather than creating a
    // new one, so it is entirely unaffected by this check — only a later
    // createToken call is. Scoped by (deviceId, queueId) only, exactly like
    // the active-token check — queueId already determines organizationId,
    // so there is no client-supplied tenant boundary to trust here. Checked
    // under the same queue-row lock acquired above (reusing the existing
    // mechanism, not a new one) — sufficient because this only ever reads
    // already-committed COMPLETED rows from an earlier, already-finished
    // transaction; it never races against another createToken call writing
    // that COMPLETED status concurrently, since a CALLED/IN_PROGRESS token
    // for this device would already have been caught by existingActive
    // above.
    if (!lockedQueue.allowRepeatVisits) {
      const existingCompleted = await tx.token.findFirst({
        where: { deviceId: device.id, queueId: input.queueId, status: 'COMPLETED' },
      });
      if (existingCompleted) {
        throw new AppError(
          409,
          'REPEAT_VISIT_NOT_ALLOWED',
          'This device has already completed a visit to this queue and repeat visits are not allowed.',
        );
      }
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
  // V2 Checkpoint 7: stripped even from the full staff shape — see
  // omitOtpFields's doc comment. This is the shape realtime/emit.ts reuses
  // directly for the organization-room socket payload, so this is also
  // where a leak into Socket.io would happen if this were skipped.
  return omitOtpFields({ ...token, services: toSelectedServices(token), ...computed });
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

    // V2 Checkpoint 7 (ADR-029): every legitimate entry into CALLED — a
    // plain /call and a Recall alike, since both paths converge here — gets
    // a brand new service-start verification code. Recall never reuses a
    // stale prior code (section 18 of the checkpoint spec); this is also
    // what makes "customer cancels while staff is mid-Recall" behave
    // correctly, since a fresh CALLED entry always starts a fresh OTP
    // lifecycle rather than inheriting whatever a much-earlier CALLED period
    // left behind.
    const otpCode = generateOtpCode();
    const otpCipher = encryptOtpCode(tokenId, otpCode);
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);

    const result = await tx.token.updateMany({
      where: { id: tokenId, status: token.status },
      data: {
        status: 'CALLED',
        counterId,
        calledAt: new Date(),
        serviceStartOtpCipher: otpCipher,
        serviceStartOtpExpiresAt: otpExpiresAt,
        serviceStartOtpFailedAttempts: 0,
      },
    });
    if (result.count === 0) {
      throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
    }

    // otpCode itself is deliberately discarded here, never returned — this
    // function's caller is staff (the one clicking Call/Recall), who must
    // never be able to read the code (checkpoint section 20). The customer
    // retrieves it separately and directly via
    // getServiceStartVerificationCode, ownership-checked against their own
    // device.
    const updated = await tx.token.findUniqueOrThrow({ where: { id: tokenId } });
    return omitOtpFields(updated);
  });
}

type TimestampField = 'completedAt' | 'skippedAt';

/**
 * Shared implementation for the two remaining counter-independent,
 * staff-triggered transitions (complete/skip). Loads current state,
 * validates the transition centrally, then applies a conditional
 * (compare-and-swap) UPDATE as the concurrency-safety net — two racing
 * requests against the same token can only have one succeed.
 *
 * V2 Checkpoint 7: CALLED -> IN_PROGRESS moved out to startTokenWithOtp
 * below (it now requires a verified code, not just a valid source status),
 * so this helper no longer handles `startedAt` — it remains the shared
 * implementation for exactly the two transitions that still need nothing
 * beyond "is this transition legal, apply it atomically."
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
): Promise<{ token: Omit<Token, 'serviceStartOtpCipher' | 'serviceStartOtpExpiresAt' | 'serviceStartOtpFailedAttempts'>; previousStatus: TokenStatus }> {
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
  return { token: omitOtpFields(updated), previousStatus };
}

export const completeToken = (organizationId: string, tokenId: string) =>
  transitionToken(organizationId, tokenId, 'COMPLETED', 'completedAt');

export const skipToken = (organizationId: string, tokenId: string) =>
  transitionToken(organizationId, tokenId, 'SKIPPED', 'skippedAt');

/**
 * V2 Checkpoint 7 (ADR-029): CALLED -> IN_PROGRESS, gated on a customer-
 * supplied, backend-verified code — the entire point being that staff
 * cannot start service merely by clicking a button (CLAUDE.md: never trust
 * a frontend-only restriction; this is the backend enforcement that makes
 * that restriction real). This is now the ONLY code path in the backend
 * capable of producing an IN_PROGRESS token — see ADR-029's security review
 * for the full repository search confirming no other route reaches it.
 *
 * Deliberately NOT built on transitionToken: every other transition there
 * only needs "is this legal, apply it" — this one needs three additional,
 * ordered checks (code issued? not expired? attempts remaining?) before the
 * same compare-and-swap pattern applies, and a wrong-code attempt must
 * itself durably record the failed attempt without transitioning anything.
 */
export async function startTokenWithOtp(
  organizationId: string,
  tokenId: string,
  verificationCode: string,
) {
  const token = await findTokenScoped(organizationId, tokenId);
  assertValidTransition(token.status, 'IN_PROGRESS');

  if (!token.serviceStartOtpCipher || !token.serviceStartOtpExpiresAt) {
    throw new AppError(
      409,
      'VERIFICATION_CODE_REQUIRED',
      'No verification code has been issued for this token yet.',
    );
  }
  if (token.serviceStartOtpExpiresAt.getTime() < Date.now()) {
    throw new AppError(
      410,
      'VERIFICATION_CODE_EXPIRED',
      'This verification code has expired. Ask the customer for a new one.',
    );
  }
  if (token.serviceStartOtpFailedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
    throw new AppError(
      429,
      'VERIFICATION_CODE_LOCKED',
      'Too many incorrect attempts with this code. Ask the customer for a new one.',
    );
  }

  const isValid = verifyOtpCode(tokenId, verificationCode, token.serviceStartOtpCipher);
  if (!isValid) {
    const attempts = token.serviceStartOtpFailedAttempts + 1;
    const lockedOut = attempts >= OTP_MAX_FAILED_ATTEMPTS;
    // Best-effort bookkeeping — if a concurrent cancellation/start already
    // moved the token out of CALLED, this simply no-ops (0 rows), which is
    // fine: the failed-attempt count no longer matters once the token has
    // left CALLED by any path.
    await prisma.token.updateMany({
      where: { id: tokenId, status: 'CALLED' },
      data: lockedOut
        ? { serviceStartOtpFailedAttempts: attempts, serviceStartOtpCipher: null, serviceStartOtpExpiresAt: null }
        : { serviceStartOtpFailedAttempts: attempts },
    });
    // Never reveals which digits were right (checkpoint section 26) — one
    // generic code regardless of how close the guess was.
    throw new AppError(422, 'INVALID_VERIFICATION_CODE', 'Incorrect verification code.');
  }

  // Single-use: the transition and the OTP invalidation happen in the same
  // conditional UPDATE, so a replay of this same code can never succeed a
  // second time — status is already IN_PROGRESS, cipher already null.
  const result = await prisma.token.updateMany({
    where: { id: tokenId, status: 'CALLED' },
    data: {
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      serviceStartOtpCipher: null,
      serviceStartOtpExpiresAt: null,
      serviceStartOtpFailedAttempts: 0,
    },
  });
  if (result.count === 0) {
    // Concurrency (checkpoint section 28): a cancellation could have won the
    // race between the checks above and this UPDATE — the WHERE clause's
    // status='CALLED' guard is what makes exactly one of {cancel, start}
    // ever succeed, mirroring transitionToken/cancelToken's identical
    // compare-and-swap pattern. No new locking mechanism.
    throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
  }

  const updated = await prisma.token.findUniqueOrThrow({ where: { id: tokenId } });
  return { token: omitOtpFields(updated), previousStatus: token.status };
}

/**
 * V2 Checkpoint 7 (ADR-029): customer-initiated cancellation. Ownership is
 * established the same way the pre-existing notification-preferences
 * customer write does (ADR-011/Phase 7 Step 7) — there is no device
 * authentication in this codebase, so a self-asserted deviceIdentifier is
 * resolved to a Device, and the token must actually belong to that device.
 * A mismatch is reported as the same 404 TOKEN_NOT_FOUND used for "doesn't
 * exist," never a 403 — this codebase never confirms a resource's existence
 * across an ownership boundary the caller isn't inside.
 *
 * Concurrency (checkpoint section 28): the same conditional
 * (compare-and-swap) UPDATE pattern used everywhere else in this file — the
 * WHERE clause's status match against the freshly-read status is what makes
 * a concurrent cancel-vs-start race resolve to exactly one winner, without
 * any new locking mechanism (see startTokenWithOtp's matching comment).
 */
export async function cancelToken(tokenId: string, deviceIdentifier: string) {
  const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token || token.deviceId !== device.id) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }

  // WAITING/CALLED -> CANCELLED only; IN_PROGRESS/COMPLETED/SKIPPED/already-
  // CANCELLED all fall through to the same generic INVALID_TOKEN_TRANSITION
  // every other illegal transition in this file produces — reusing the
  // existing error architecture rather than inventing a one-off code for
  // this specific case (including the "cancel an already-cancelled token"
  // case, which needs no special-cased semantics of its own).
  assertValidTransition(token.status, 'CANCELLED');

  const result = await prisma.token.updateMany({
    where: { id: tokenId, status: token.status },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      // Checkpoint section 19: a cancelled token's verification material
      // must never remain usable.
      serviceStartOtpCipher: null,
      serviceStartOtpExpiresAt: null,
      serviceStartOtpFailedAttempts: 0,
    },
  });
  if (result.count === 0) {
    throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
  }

  const updated = await prisma.token.findUniqueOrThrow({ where: { id: tokenId } });
  return { token: omitOtpFields(updated), previousStatus: token.status };
}

/**
 * V2 Checkpoint 7 (ADR-029): the customer's own read of the currently
 * active verification code — the ONLY path anywhere in the backend that
 * ever returns the raw (decrypted) code, and only after confirming this
 * exact device owns this exact token. Deliberately not folded into
 * getTokenCustomerView/toCustomerView: that function's result is also
 * reused directly for the Socket.io token-room payload (realtime/emit.ts),
 * which must never carry the OTP (checkpoint section 20/33) — keeping this
 * as a fully separate function makes that leak structurally impossible
 * rather than something a future edit could accidentally reintroduce.
 *
 * Never regenerates on a read (checkpoint section 23) — returns the same
 * code every call until it's consumed, expires, or is explicitly reissued.
 */
export async function getServiceStartVerificationCode(tokenId: string, deviceIdentifier: string) {
  const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token || token.deviceId !== device.id) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }
  if (token.status !== 'CALLED') {
    throw new AppError(
      409,
      'TOKEN_NOT_CALLED',
      'A verification code is only available while this token is CALLED.',
    );
  }
  if (!token.serviceStartOtpCipher || !token.serviceStartOtpExpiresAt || token.serviceStartOtpExpiresAt.getTime() < Date.now()) {
    throw new AppError(
      410,
      'VERIFICATION_CODE_EXPIRED',
      'This verification code has expired. Request a new one.',
    );
  }

  const code = decryptOtpCode(tokenId, token.serviceStartOtpCipher);
  if (!code) {
    // Practically unreachable (would mean a corrupted/tampered stored
    // value) — treated the same as expired rather than a 500, since the
    // customer-facing remedy is identical either way: request a new code.
    throw new AppError(
      410,
      'VERIFICATION_CODE_EXPIRED',
      'This verification code has expired. Request a new one.',
    );
  }

  return { code, expiresAt: token.serviceStartOtpExpiresAt };
}

/**
 * V2 Checkpoint 7 (ADR-029): the smallest safe renewal path (section 23) —
 * a customer whose code expired, or who simply didn't catch it, is never
 * permanently stuck in CALLED. Same ownership check as the getter above;
 * unconditionally mints a fresh code and expiry, invalidating whatever was
 * there before (overwritten, not merged) and resetting the failed-attempt
 * counter. Rate-limited at the route level (publicRateLimiter), the same
 * category the pre-existing notification-preferences customer write uses —
 * this function itself never regenerates except when explicitly called.
 */
export async function reissueServiceStartVerificationCode(tokenId: string, deviceIdentifier: string) {
  const device = await prisma.device.findUnique({ where: { deviceIdentifier } });
  if (!device) {
    throw new AppError(404, 'DEVICE_NOT_FOUND', 'Device not found.');
  }

  const token = await prisma.token.findUnique({ where: { id: tokenId } });
  if (!token || token.deviceId !== device.id) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found.');
  }
  if (token.status !== 'CALLED') {
    throw new AppError(
      409,
      'TOKEN_NOT_CALLED',
      'A verification code can only be reissued while this token is CALLED.',
    );
  }

  const code = generateOtpCode();
  const cipher = encryptOtpCode(tokenId, code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);

  const result = await prisma.token.updateMany({
    where: { id: tokenId, status: 'CALLED' },
    data: {
      serviceStartOtpCipher: cipher,
      serviceStartOtpExpiresAt: expiresAt,
      serviceStartOtpFailedAttempts: 0,
    },
  });
  if (result.count === 0) {
    throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
  }

  return { code, expiresAt };
}

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
) {
  const token = await findTokenScoped(organizationId, tokenId);

  if (token.status !== 'CALLED' && token.status !== 'IN_PROGRESS') {
    throw new AppError(
      409,
      'TOKEN_NOT_ACTIVE',
      'Required duration can only be set for a currently CALLED or IN_PROGRESS customer.',
    );
  }

  const updated = await prisma.token.update({
    where: { id: tokenId },
    data: { requiredDurationMinutes },
  });
  return omitOtpFields(updated);
}

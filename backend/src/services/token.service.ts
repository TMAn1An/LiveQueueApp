import type { Counter, Prisma, QueueFormField, Token, TokenStatus } from '@prisma/client';
import { z, type ZodTypeAny } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertValidTransition } from '../utils/tokenStateMachine';
import { findCounterScoped } from './counter.service';
import { requireOwnedQueue } from '../utils/tenantScope';
import { registerDevice } from './device.service';
import type { AuthContext } from '../utils/authContext';

const QUEUE_ARCHIVED_MSG = 'This queue has been archived and can no longer accept new tokens.';
const QUEUE_NOT_ACTIVE_MSG = 'This queue is currently not accepting new customers.';

export interface CreateTokenInput {
  queueId: string;
  serviceId: string;
  deviceIdentifier: string;
  formData: Record<string, unknown>;
}

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

function assertIdempotentPayloadMatches(
  existing: Token,
  input: CreateTokenInput,
  validatedFormData: Record<string, unknown>,
): void {
  const same =
    existing.queueId === input.queueId &&
    existing.serviceId === input.serviceId &&
    deepEqual(existing.formData, validatedFormData);

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

  const service = await prisma.queueService.findFirst({
    where: { id: input.serviceId, queueId: input.queueId },
  });
  if (!service) {
    throw new AppError(404, 'SERVICE_NOT_FOUND', 'Service not found.');
  }
  if (!service.isActive) {
    throw new AppError(409, 'SERVICE_NOT_ACTIVE', 'This service is not currently available.');
  }

  const device = await registerDevice(input.deviceIdentifier);
  if (device.status === 'BLOCKED') {
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
  });
  if (preCheck) {
    assertIdempotentPayloadMatches(preCheck, input, formData);
    return finalizeTokenResponse(preCheck.id);
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
    });
    if (existing) {
      assertIdempotentPayloadMatches(existing, input, formData);
      return existing;
    }

    const sequenceNumber = lockedQueue.nextTokenNumber;
    await tx.queue.update({
      where: { id: input.queueId },
      data: { nextTokenNumber: sequenceNumber + 1 },
    });

    return tx.token.create({
      data: {
        organizationId: lockedQueue.organizationId,
        queueId: input.queueId,
        serviceId: input.serviceId,
        deviceId: device.id,
        sequenceNumber,
        serialNumber: `${lockedQueue.tokenPrefix}${String(sequenceNumber).padStart(3, '0')}`,
        status: 'WAITING',
        formData: formData as Prisma.InputJsonValue,
        formVersion: lockedQueue.formVersion,
        idempotencyKey,
      },
    });
  });

  return finalizeTokenResponse(created.id);
}

async function computeComputedFields(
  token: Token,
): Promise<{ position: number | null; estimatedWaitMinutes: number | null }> {
  if (token.status !== 'WAITING') {
    return { position: null, estimatedWaitMinutes: null };
  }

  const [aheadCount, service, queue, activeCounters] = await Promise.all([
    prisma.token.count({
      where: { queueId: token.queueId, status: 'WAITING', sequenceNumber: { lt: token.sequenceNumber } },
    }),
    prisma.queueService.findUnique({ where: { id: token.serviceId } }),
    prisma.queue.findUnique({ where: { id: token.queueId } }),
    prisma.counter.count({ where: { queueId: token.queueId, status: 'ACTIVE' } }),
  ]);

  const position = aheadCount + 1;

  if (activeCounters === 0) {
    // With no counter actively serving, "duration × position ÷ counters" has
    // no meaningful denominator — an estimate here would imply active
    // service that isn't happening (approved product decision, 2026-08-22).
    return { position, estimatedWaitMinutes: null };
  }

  const durationMinutes = service?.durationMinutes ?? queue?.baseTimeMinutes ?? 5;
  const estimatedWaitMinutes = Math.ceil((durationMinutes * position) / activeCounters);

  return { position, estimatedWaitMinutes };
}

/**
 * Customer-safe view (approved decision 8): no organizationId, deviceId,
 * idempotencyKey, or formVersion — only what the customer needs to track
 * their own token, plus which counter to go to once called.
 */
function toCustomerView(
  token: Token & { counter?: Counter | null },
  computed: { position: number | null; estimatedWaitMinutes: number | null },
) {
  return {
    id: token.id,
    queueId: token.queueId,
    serviceId: token.serviceId,
    serialNumber: token.serialNumber,
    status: token.status,
    formData: token.formData,
    position: computed.position,
    estimatedWaitMinutes: computed.estimatedWaitMinutes,
    counter: token.counter ? { id: token.counter.id, name: token.counter.name } : null,
    createdAt: token.createdAt,
    calledAt: token.calledAt,
    startedAt: token.startedAt,
    completedAt: token.completedAt,
    skippedAt: token.skippedAt,
  };
}

function toStaffView(
  token: Token & { counter?: Counter | null },
  computed: { position: number | null; estimatedWaitMinutes: number | null },
) {
  return { ...token, ...computed };
}

async function finalizeTokenResponse(tokenId: string) {
  const token = await prisma.token.findUniqueOrThrow({
    where: { id: tokenId },
    include: { counter: true },
  });
  const computed = await computeComputedFields(token);
  return toCustomerView(token, computed);
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
    include: { counter: true },
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
 */
export async function callToken(organizationId: string, tokenId: string, counterId: string) {
  const token = await findTokenScoped(organizationId, tokenId);
  const counter = await findCounterScoped(organizationId, counterId);

  if (counter.queueId !== token.queueId) {
    throw new AppError(409, 'COUNTER_QUEUE_MISMATCH', "Counter does not belong to the token's queue.");
  }

  assertValidTransition(token.status, 'CALLED');

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

    const result = await tx.token.updateMany({
      where: { id: tokenId, status: 'WAITING' },
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
 */
async function transitionToken(
  organizationId: string,
  tokenId: string,
  targetStatus: TokenStatus,
  timestampField: TimestampField,
): Promise<Token> {
  const token = await findTokenScoped(organizationId, tokenId);
  assertValidTransition(token.status, targetStatus);

  const result = await prisma.token.updateMany({
    where: { id: tokenId, status: token.status },
    data: { status: targetStatus, [timestampField]: new Date() },
  });
  if (result.count === 0) {
    throw new AppError(409, 'TOKEN_STATE_CHANGED', 'Token state changed concurrently. Please retry.');
  }

  return prisma.token.findUniqueOrThrow({ where: { id: tokenId } });
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

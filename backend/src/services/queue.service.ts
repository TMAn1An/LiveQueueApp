import type { Queue, QueueService, QueueStatus } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { resolveQueueTimezone, resolveRepeatPolicy } from './queueIdentityPolicy.service';
import { requireScheduleTimezone } from './queueSchedule.service';
import { AppError } from '../utils/AppError';
import { assertQueueMutable } from '../utils/tenantScope';
import type { createQueueSchema, updateQueueSchema } from '../validators/queue.validators';

type CreateQueueInput = z.infer<typeof createQueueSchema.body>;
type UpdateQueueInput = z.infer<typeof updateQueueSchema.body>;

type QueueWithServices = Queue & { services: QueueService[] };

function serializeQueue(queue: QueueWithServices) {
  return {
    ...queue,
    qrCodeUri: `livequeue://queue/${queue.id}`,
  };
}

async function findQueueOrThrow(
  organizationId: string,
  queueId: string,
): Promise<QueueWithServices> {
  const queue = await prisma.queue.findFirst({
    where: { id: queueId, organizationId },
    include: { services: true },
  });

  if (!queue) {
    throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
  }

  return queue;
}

/**
 * Counter count is a DB-level aggregate (Prisma `_count`, a single COUNT
 * subquery per row via one query overall — not one request per queue),
 * used only here to power the dashboard's queue-list "Counters" column
 * (Issue 1: discoverability). No other queue endpoint needs it, so
 * serializeQueue/QueueWithServices stay untouched.
 */
export async function listQueues(organizationId: string) {
  const queues = await prisma.queue.findMany({
    where: { organizationId, deletedAt: null },
    include: { services: true, _count: { select: { counters: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // ADR-036: each queue is its own line, so the overview has to say how each
  // one is doing on its own. Two grouped counts rather than a query per
  // queue — the numbers a supervisor actually scans for are "is anyone
  // waiting" and "is anyone serving them".
  const queueIds = queues.map((queue) => queue.id);
  const [waitingByQueue, activeCounterGroups] = await Promise.all([
    countWaitingByQueue(organizationId, queueIds),
    prisma.counter.groupBy({
      by: ['queueId'],
      where: { queueId: { in: queueIds }, status: 'ACTIVE' },
      _count: { _all: true },
    }),
  ]);
  const activeCountersByQueue = new Map(
    activeCounterGroups.map((row) => [row.queueId, row._count._all]),
  );

  return queues.map(({ _count, ...queue }) => ({
    ...serializeQueue(queue),
    counterCount: _count.counters,
    waitingCount: waitingByQueue.get(queue.id) ?? 0,
    activeCounterCount: activeCountersByQueue.get(queue.id) ?? 0,
  }));
}

/**
 * The people waiting in each queue right now, in one grouped query for any
 * number of queues (no per-queue round trip).
 *
 * "Waiting" means WAITING and in the line now: a token booked into a session
 * that has not started yet is not in the callable line (ADR-048) and is not
 * counted, matching how positions are numbered. CALLED, IN_PROGRESS and
 * every terminal status are excluded by the status filter. Scoped to the
 * organization and grouped per queue, so queues never mix.
 */
export async function countWaitingByQueue(
  organizationId: string,
  queueIds: string[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  if (queueIds.length === 0) return new Map();
  const groups = await prisma.token.groupBy({
    by: ['queueId'],
    where: {
      organizationId,
      queueId: { in: queueIds },
      status: 'WAITING',
      OR: [{ assignedSessionStartsAt: null }, { assignedSessionStartsAt: { lte: now } }],
    },
    _count: { _all: true },
  });
  return new Map(groups.map((row) => [row.queueId, row._count._all]));
}

export async function getQueue(organizationId: string, queueId: string) {
  const queue = await findQueueOrThrow(organizationId, queueId);
  const waiting = await countWaitingByQueue(organizationId, [queue.id]);
  // The Live Queue header reads this; it was previously only on the list.
  return { ...serializeQueue(queue), waitingCount: waiting.get(queue.id) ?? 0 };
}

export async function createQueue(organizationId: string, input: CreateQueueInput) {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  // A new queue starts on the organization's clock (ADR-035) and only carries
  // its own zone if someone later says it sits somewhere else.
  const timezone = input.timezone?.trim() || null;
  // A brand-new queue has no form fields yet, so a policy naming a custom
  // identity field is rejected here and configured after the form exists.
  const policy = await resolveRepeatPolicy(
    null,
    null,
    input,
    resolveQueueTimezone({ timezone }, organization),
  );

  const queue = await prisma.queue.create({
    data: {
      organizationId,
      name: input.name,
      description: input.description,
      clientTerminology: input.clientTerminology,
      tokenPrefix: input.tokenPrefix,
      startingNumber: input.startingNumber,
      nextTokenNumber: input.startingNumber,
      baseTimeMinutes: input.baseTimeMinutes,
      defaultNotificationMinutes: input.defaultNotificationMinutes,
      status: input.status,
      allowMultipleServices: input.allowMultipleServices,
      requireServiceStartOtp: input.requireServiceStartOtp,
      timezone,
      ...policy,
    },
    include: { services: true },
  });

  return serializeQueue(queue);
}

/**
 * ADR-055: multiple-service support and the service-start verification code
 * are chosen when a queue is created and never change afterwards, in either
 * direction. Both alter what customers and staff are entitled to do mid-visit,
 * so neither may shift under a queue that is already operating.
 *
 * A request repeating the stored value is a harmless no-op (a client sending
 * its whole settings form back); only an actual change is refused, with a
 * stable code so a crafted request learns exactly why.
 */
const CREATION_ONLY_SETTINGS = {
  allowMultipleServices: 'Multiple-service support',
  requireServiceStartOtp: 'Service-start verification',
} as const;

function assertCreationSettingsUnchanged(
  existing: Pick<Queue, keyof typeof CREATION_ONLY_SETTINGS>,
  input: Partial<Record<keyof typeof CREATION_ONLY_SETTINGS, boolean>>,
): void {
  for (const key of Object.keys(CREATION_ONLY_SETTINGS) as (keyof typeof CREATION_ONLY_SETTINGS)[]) {
    if (input[key] !== undefined && input[key] !== existing[key]) {
      throw new AppError(
        409,
        'QUEUE_SETTING_IMMUTABLE',
        `${CREATION_ONLY_SETTINGS[key]} is fixed when a queue is created and cannot be changed.`,
        { field: key },
      );
    }
  }
}

export async function updateQueue(
  organizationId: string,
  queueId: string,
  input: UpdateQueueInput,
) {
  const existing = await findQueueOrThrow(organizationId, queueId);
  assertQueueMutable(existing);
  assertCreationSettingsUnchanged(existing, input);

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const nextTimezone =
    input.timezone === undefined ? existing.timezone : input.timezone?.trim() || null;
  const effectiveTimezone = resolveQueueTimezone({ timezone: nextTimezone }, organization);
  const nextScheduleEnabled = input.scheduleEnabled ?? existing.scheduleEnabled;

  // Merged against what is already stored: a request that only renames the
  // queue must not be read as clearing its identity policy.
  const policy = await resolveRepeatPolicy(
    queueId,
    { queueId, version: existing.formVersion },
    {
      allowRepeatVisits: input.allowRepeatVisits ?? existing.allowRepeatVisits,
      repeatRestrictionType:
        input.repeatRestrictionType === undefined
          ? existing.repeatRestrictionType
          : input.repeatRestrictionType,
      repeatRestrictionAmount:
        input.repeatRestrictionAmount === undefined
          ? existing.repeatRestrictionAmount
          : input.repeatRestrictionAmount,
      repeatRestrictionUnit:
        input.repeatRestrictionUnit === undefined
          ? existing.repeatRestrictionUnit
          : input.repeatRestrictionUnit,
      repeatRestrictionUntilLocal: input.repeatRestrictionUntilLocal,
      repeatIdentityMode:
        input.repeatIdentityMode === undefined ? existing.repeatIdentityMode : input.repeatIdentityMode,
      repeatIdentityFieldKey:
        input.repeatIdentityFieldKey === undefined
          ? existing.repeatIdentityFieldKey
          : input.repeatIdentityFieldKey,
      repeatRestrictionScope:
        input.repeatRestrictionScope == null
          ? existing.repeatRestrictionScope
          : input.repeatRestrictionScope,
    },
    effectiveTimezone,
    // ADR-049: the schedule state *after* this request, so turning the
    // schedule off while a per-session limit is on is refused in one place.
    nextScheduleEnabled,
  );

  // Phase 4: every session window is evaluated on the queue's own clock, so
  // scheduling cannot be turned on (or stay on, if this same request also
  // clears the timezone) without a real one resolved.
  if (nextScheduleEnabled) {
    requireScheduleTimezone(effectiveTimezone);
  }

  const queue = await prisma.queue.update({
    where: { id: queueId },
    data: {
      ...input,
      // ADR-055: fixed at creation. An unchanged value is accepted above as
      // a no-op, and is never written back.
      allowMultipleServices: undefined,
      requireServiceStartOtp: undefined,
      timezone: nextTimezone,
      // The wall-clock cutoff is a policy input, not a column — resolveRepeatPolicy
      // turns it into the absolute instant stored below.
      repeatRestrictionUntilLocal: undefined,
      ...policy,
    },
    include: { services: true },
  });

  return serializeQueue(queue);
}

export async function updateQueueStatus(
  organizationId: string,
  queueId: string,
  status: QueueStatus,
) {
  const existing = await findQueueOrThrow(organizationId, queueId);
  assertQueueMutable(existing);

  const queue = await prisma.queue.update({
    where: { id: queueId },
    data: { status },
    include: { services: true },
  });

  return serializeQueue(queue);
}

/**
 * Archiving is itself the one allowed transition out of the mutable state,
 * so it is not gated by assertQueueMutable. A queue that is *already*
 * archived, however, must not be mutated further — including by a repeat
 * delete call — so a second delete now fails with the same archived error
 * rather than silently no-opping.
 */
export async function softDeleteQueue(organizationId: string, queueId: string) {
  const existing = await findQueueOrThrow(organizationId, queueId);
  assertQueueMutable(existing);

  const queue = await prisma.queue.update({
    where: { id: queueId },
    data: { deletedAt: new Date() },
    include: { services: true },
  });

  return serializeQueue(queue);
}

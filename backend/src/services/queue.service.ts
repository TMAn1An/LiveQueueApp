import type { Queue, QueueService, QueueStatus } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { resolveQueueTimezone, resolveRepeatPolicy } from './queueIdentityPolicy.service';
import { issueServiceStartCodesForCalledTokens } from './token.service';
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
  const [waitingGroups, activeCounterGroups] = await Promise.all([
    prisma.token.groupBy({
      by: ['queueId'],
      where: { organizationId, queueId: { in: queueIds }, status: 'WAITING' },
      _count: { _all: true },
    }),
    prisma.counter.groupBy({
      by: ['queueId'],
      where: { queueId: { in: queueIds }, status: 'ACTIVE' },
      _count: { _all: true },
    }),
  ]);
  const waitingByQueue = new Map(waitingGroups.map((row) => [row.queueId, row._count._all]));
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

export async function getQueue(organizationId: string, queueId: string) {
  const queue = await findQueueOrThrow(organizationId, queueId);
  return serializeQueue(queue);
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

export async function updateQueue(
  organizationId: string,
  queueId: string,
  input: UpdateQueueInput,
) {
  const existing = await findQueueOrThrow(organizationId, queueId);
  assertQueueMutable(existing);

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

  // ADR-041: switching the service-start code ON must not strand a customer
  // already at a counter without one, so their codes are issued in the same
  // transaction as the change. Switching it OFF needs nothing here — the
  // start path reads the current setting and ignores any code left behind.
  const enablingServiceStartCode =
    input.requireServiceStartOtp === true && !existing.requireServiceStartOtp;

  // Phase 4: every session window is evaluated on the queue's own clock, so
  // scheduling cannot be turned on (or stay on, if this same request also
  // clears the timezone) without a real one resolved.
  if (nextScheduleEnabled) {
    requireScheduleTimezone(effectiveTimezone);
  }

  const queue = await prisma.$transaction(async (tx) => {
    const updated = await tx.queue.update({
      where: { id: queueId },
      data: {
        ...input,
        timezone: nextTimezone,
        // The wall-clock cutoff is a policy input, not a column — resolveRepeatPolicy
        // turns it into the absolute instant stored below.
        repeatRestrictionUntilLocal: undefined,
        ...policy,
      },
      include: { services: true },
    });
    if (enablingServiceStartCode) {
      await issueServiceStartCodesForCalledTokens(tx, queueId);
    }
    return updated;
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

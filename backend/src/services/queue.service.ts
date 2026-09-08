import type { Queue, QueueService, QueueStatus } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { resolveQueueTimezone, resolveRepeatPolicy } from './queueIdentityPolicy.service';
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

  return queues.map(({ _count, ...queue }) => ({
    ...serializeQueue(queue),
    counterCount: _count.counters,
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
    },
    effectiveTimezone,
  );

  const queue = await prisma.queue.update({
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

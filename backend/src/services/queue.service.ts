import type { Queue, QueueService, QueueStatus } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
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

export async function listQueues(organizationId: string) {
  const queues = await prisma.queue.findMany({
    where: { organizationId, deletedAt: null },
    include: { services: true },
    orderBy: { createdAt: 'desc' },
  });

  return queues.map(serializeQueue);
}

export async function getQueue(organizationId: string, queueId: string) {
  const queue = await findQueueOrThrow(organizationId, queueId);
  return serializeQueue(queue);
}

export async function createQueue(organizationId: string, input: CreateQueueInput) {
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

  const queue = await prisma.queue.update({
    where: { id: queueId },
    data: input,
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

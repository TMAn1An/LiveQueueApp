import type { Queue } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from './AppError';

/**
 * Verifies a queue belongs to the authenticated organization before any
 * nested resource (service/counter/form field) is created or read under it.
 * Never authorize using the queueId alone (CLAUDE.md Rule 4).
 */
export async function requireOwnedQueue(organizationId: string, queueId: string): Promise<Queue> {
  const queue = await prisma.queue.findFirst({ where: { id: queueId, organizationId } });
  if (!queue) {
    throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
  }
  return queue;
}

/**
 * An archived queue (deletedAt set) may still be read (approved decision 4)
 * but must never be mutated — directly, or through any of its services,
 * counters, or form fields. Callers must resolve tenant ownership first
 * (via requireOwnedQueue or an equivalent join) and only then call this;
 * it never replaces the ownership check, only adds to it.
 */
export function assertQueueMutable(queue: Pick<Queue, 'deletedAt'>): void {
  if (queue.deletedAt) {
    throw new AppError(
      409,
      'QUEUE_ARCHIVED',
      'This queue has been archived and can no longer be modified.',
    );
  }
}

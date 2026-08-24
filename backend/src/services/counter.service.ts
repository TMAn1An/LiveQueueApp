import type { Counter, CounterStatus, Queue } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertQueueMutable, requireOwnedQueue } from '../utils/tenantScope';
import type { createCounterSchema, updateCounterSchema } from '../validators/counter.validators';

type CreateCounterInput = z.infer<typeof createCounterSchema.body>;
type UpdateCounterInput = z.infer<typeof updateCounterSchema.body>;

/**
 * counter → queue → organizationId — never authorize using counterId alone.
 * The parent queue is included so mutation paths can also check its
 * archived state.
 */
export async function findCounterScoped(
  organizationId: string,
  counterId: string,
): Promise<Counter & { queue: Queue }> {
  const counter = await prisma.counter.findFirst({
    where: { id: counterId, queue: { organizationId } },
    include: { queue: true },
  });

  if (!counter) {
    throw new AppError(404, 'COUNTER_NOT_FOUND', 'Counter not found.');
  }

  return counter;
}

export async function listCounters(organizationId: string, queueId: string) {
  await requireOwnedQueue(organizationId, queueId);
  return prisma.counter.findMany({ where: { queueId }, orderBy: { createdAt: 'asc' } });
}

export async function createCounter(
  organizationId: string,
  queueId: string,
  input: CreateCounterInput,
) {
  const queue = await requireOwnedQueue(organizationId, queueId);
  assertQueueMutable(queue);
  return prisma.counter.create({ data: { queueId, name: input.name } });
}

export async function updateCounter(
  organizationId: string,
  counterId: string,
  input: UpdateCounterInput,
) {
  const counter = await findCounterScoped(organizationId, counterId);
  assertQueueMutable(counter.queue);
  return prisma.counter.update({ where: { id: counterId }, data: input });
}

export async function setCounterStatus(
  organizationId: string,
  counterId: string,
  status: CounterStatus,
) {
  const counter = await findCounterScoped(organizationId, counterId);
  assertQueueMutable(counter.queue);
  return prisma.counter.update({ where: { id: counterId }, data: { status } });
}

export async function deleteCounter(organizationId: string, counterId: string) {
  const counter = await findCounterScoped(organizationId, counterId);
  assertQueueMutable(counter.queue);
  await prisma.counter.delete({ where: { id: counterId } });
}

/**
 * Assignment must verify the target staff member belongs to the same
 * organization as the counter — never trust a staffId in isolation. A staff
 * member (regardless of role) may be assigned to at most one counter at a
 * time — physically they can only be at one counter — so any existing
 * assignment elsewhere is rejected rather than silently reassigned.
 */
export async function assignCounter(organizationId: string, counterId: string, staffId: string) {
  const counter = await findCounterScoped(organizationId, counterId);
  assertQueueMutable(counter.queue);

  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staff) {
    throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff member not found.');
  }
  if (staff.organizationId !== organizationId) {
    throw new AppError(
      403,
      'STAFF_ORGANIZATION_MISMATCH',
      'Staff member does not belong to this organization.',
    );
  }

  const existingAssignment = await prisma.counter.findFirst({
    where: { staffId, id: { not: counterId } },
  });
  if (existingAssignment) {
    throw new AppError(
      409,
      'STAFF_ALREADY_ASSIGNED',
      'This staff member is already assigned to another counter.',
    );
  }

  return prisma.counter.update({ where: { id: counterId }, data: { staffId } });
}

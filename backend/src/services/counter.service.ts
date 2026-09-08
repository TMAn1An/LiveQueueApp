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

/** Returns the deleted counter's queue id so the caller can recompute that
 * queue's ETAs — removing an ACTIVE counter changes serving capacity. */
export async function deleteCounter(organizationId: string, counterId: string) {
  const counter = await findCounterScoped(organizationId, counterId);
  assertQueueMutable(counter.queue);
  await prisma.counter.delete({ where: { id: counterId } });
  return { queueId: counter.queueId };
}

/**
 * Assignment must verify the target staff member belongs to the same
 * organization as the counter — never trust a staffId in isolation. A staff
 * member (regardless of role) may be assigned to at most one counter at a
 * time — physically they can only be at one counter — so any existing
 * assignment elsewhere is rejected rather than silently reassigned.
 */
const STAFF_ALREADY_ASSIGNED = new AppError(
  409,
  'STAFF_ALREADY_ASSIGNED',
  'This staff member is already assigned to another counter.',
);

/**
 * Staff who may be put on this counter right now: everyone in the
 * organization who is operationally active and holds no counter, plus this
 * counter's own current assignee (who must stay selectable while editing the
 * counter they already hold).
 *
 * "Free" means no counter row references them — deliberately *not* a
 * presence/session concept, and deliberately unaffected by the holding
 * counter's status: an ON_BREAK or OFFLINE counter still has its person, and
 * they become free only by being explicitly unassigned or reassigned.
 */
export async function listAssignableStaff(organizationId: string, counterId: string) {
  const counter = await findCounterScoped(organizationId, counterId);

  return prisma.staff.findMany({
    where: {
      organizationId,
      // SUSPENDED and PENDING_EMAIL_VERIFICATION accounts cannot operate a
      // counter, so they are not offered as options.
      status: 'ACTIVE',
      OR: [
        { counters: { none: {} } },
        ...(counter.staffId ? [{ id: counter.staffId }] : []),
      ],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, role: true },
  });
}

/**
 * Assigns a staff member to this counter, or clears the assignment when
 * `staffId` is null.
 *
 * The pre-check below gives a clean 409 for the ordinary case; the unique
 * index on `Counter.staffId` is what actually makes the rule hold, since two
 * admins assigning the same free person concurrently would both pass a
 * read-then-write check. Both paths surface the identical error, so a caller
 * cannot tell (and does not need to) which one caught it.
 */
export async function assignCounter(
  organizationId: string,
  counterId: string,
  staffId: string | null,
) {
  const counter = await findCounterScoped(organizationId, counterId);
  assertQueueMutable(counter.queue);

  if (staffId === null) {
    return prisma.counter.update({ where: { id: counterId }, data: { staffId: null } });
  }

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
  if (staff.status !== 'ACTIVE') {
    throw new AppError(
      409,
      'STAFF_NOT_ASSIGNABLE',
      'Only an active staff member can be assigned to a counter.',
    );
  }

  const existingAssignment = await prisma.counter.findFirst({
    where: { staffId, id: { not: counterId } },
  });
  if (existingAssignment) {
    throw STAFF_ALREADY_ASSIGNED;
  }

  try {
    return await prisma.counter.update({ where: { id: counterId }, data: { staffId } });
  } catch (err) {
    // P2002 on counters_staff_id_key: another transaction claimed this staff
    // member between the check above and this write.
    if (isUniqueViolation(err, 'staffId')) {
      throw STAFF_ALREADY_ASSIGNED;
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown, field: string): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return false;
  }
  if ((err as { code?: unknown }).code !== 'P2002') {
    return false;
  }
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.includes(field) : true;
}

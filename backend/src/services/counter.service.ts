import type { Counter, CounterStatus, Queue } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertQueueMutable, requireOwnedQueue } from '../utils/tenantScope';
import {
  assertMayManageCounters,
  assertNoActiveServiceAtCounter,
  findAssignedCounter,
  type CounterActor,
} from './counterAccess.service';
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
  actor: CounterActor,
  queueId: string,
  input: CreateCounterInput,
) {
  assertMayManageCounters(actor);
  const queue = await requireOwnedQueue(actor.organizationId, queueId);
  assertQueueMutable(queue);
  return prisma.counter.create({ data: { queueId, name: input.name } });
}

export async function updateCounter(
  actor: CounterActor,
  counterId: string,
  input: UpdateCounterInput,
) {
  const counter = await findCounterScoped(actor.organizationId, counterId);
  assertQueueMutable(counter.queue);
  assertMayManageCounters(actor);
  return prisma.counter.update({ where: { id: counterId }, data: input });
}

export async function setCounterStatus(
  actor: CounterActor,
  counterId: string,
  status: CounterStatus,
) {
  const counter = await findCounterScoped(actor.organizationId, counterId);
  assertQueueMutable(counter.queue);
  // ADR-064: opening and closing counters is owner/admin management.
  assertMayManageCounters(actor);
  return prisma.counter.update({ where: { id: counterId }, data: { status } });
}

/** Returns the deleted counter's queue id so the caller can recompute that
 * queue's ETAs — removing an ACTIVE counter changes serving capacity. */
export async function deleteCounter(actor: CounterActor, counterId: string) {
  assertMayManageCounters(actor);
  const counter = await findCounterScoped(actor.organizationId, counterId);
  assertQueueMutable(counter.queue);
  await prisma.$transaction(async (tx) => {
    // ADR-064: never orphan a person who is called or being served here.
    await assertNoActiveServiceAtCounter(tx, counterId);
    await tx.counter.delete({ where: { id: counterId } });
  });
  return { queueId: counter.queueId };
}

/** ADR-064: the caller's own counter with its queue's name, or null. */
export async function getMyCounter(actor: CounterActor) {
  const counter = await findAssignedCounter(actor);
  if (!counter) {
    return null;
  }
  return {
    id: counter.id,
    name: counter.name,
    status: counter.status,
    queueId: counter.queueId,
    queueName: counter.queue.name,
  };
}

/**
 * ADR-064: one operator — OWNER, ADMIN or STAFF — holds at most one counter,
 * across every queue. Enforced by the unique index on `Counter.staffId`
 * (counters_staff_id_key); the checks below give a clear error first and a
 * deliberate Move instead of a silent replacement.
 */
function alreadyAssigned(where?: { counterName: string; queueName: string }): AppError {
  return new AppError(
    409,
    'OPERATOR_ALREADY_ASSIGNED',
    where
      ? `This person is already assigned to ${where.counterName} (${where.queueName}). Unassign them there, or move them here, first.`
      : 'This person is already assigned to another counter. Unassign them there, or move them here, first.',
  );
}

/**
 * Everyone who could stand at this counter — active OWNER, ADMIN and STAFF
 * members of the organization — with where they stand now. Someone with no
 * counter (or already on this one) is free to assign; someone on another
 * counter is listed with that counter so the dashboard can offer an explicit
 * Move rather than a silent replacement.
 *
 * SUSPENDED and PENDING_EMAIL_VERIFICATION accounts cannot operate a counter,
 * so they are not offered.
 */
export async function listAssignableStaff(organizationId: string, counterId: string) {
  await findCounterScoped(organizationId, counterId);

  const members = await prisma.staff.findMany({
    where: { organizationId, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      counters: { select: { id: true, name: true, queue: { select: { name: true } } } },
    },
  });
  return members.map(({ counters, ...member }) => {
    const current = counters[0] ?? null;
    return {
      ...member,
      currentCounter:
        current && current.id !== counterId
          ? { id: current.id, name: current.name, queueName: current.queue.name }
          : null,
    };
  });
}

/**
 * Assigns an operator to this counter, clears it (`staffId: null`), or —
 * with `move` — moves an operator here from the counter they hold now.
 *
 * Everything happens in one transaction that locks the counter rows it
 * touches FOR UPDATE (the same lock a claim takes):
 *  - the operator currently here is never taken away from a person they
 *    called or are serving (COUNTER_HAS_ACTIVE_SERVICE), nor is a moved
 *    operator taken from theirs;
 *  - an operator already on another counter is refused unless `move` says
 *    otherwise (OPERATOR_ALREADY_ASSIGNED); a move releases the old counter
 *    and takes the new one in the same commit, so there is never a moment
 *    with two;
 *  - two concurrent assignments of one operator to two counters cannot both
 *    commit: the unique index refuses the second, reported the same way.
 */
export async function assignCounter(
  organizationId: string,
  counterId: string,
  staffId: string | null,
  options: { move?: boolean } = {},
) {
  const counter = await findCounterScoped(organizationId, counterId);
  assertQueueMutable(counter.queue);

  // Re-assigning the same person is a no-op; anything that takes the
  // current operator away from this counter must not orphan their visit.
  const changesHolder = counter.staffId !== null && counter.staffId !== staffId;

  if (staffId === null) {
    return prisma.$transaction(async (tx) => {
      if (changesHolder) await assertNoActiveServiceAtCounter(tx, counterId);
      const updated = await tx.counter.update({ where: { id: counterId }, data: { staffId: null } });
      return Object.assign(updated, { movedFromCounterId: null as string | null });
    });
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
      'OPERATOR_NOT_ASSIGNABLE',
      'Only an active member of the organization can be assigned to a counter.',
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (changesHolder) {
        await assertNoActiveServiceAtCounter(tx, counterId);
      } else {
        await tx.$queryRaw`SELECT id FROM counters WHERE id = ${counterId} FOR UPDATE`;
      }
      const elsewhere = await tx.$queryRaw<{ id: string; name: string; queue_name: string }[]>`
        SELECT c.id, c.name, q.name AS queue_name
        FROM counters c JOIN queues q ON q.id = c.queue_id
        WHERE c.staff_id = ${staffId} AND c.id <> ${counterId}
        FOR UPDATE OF c
      `;
      const previous = elsewhere[0];
      if (previous) {
        if (!options.move) {
          throw alreadyAssigned({ counterName: previous.name, queueName: previous.queue_name });
        }
        await assertNoActiveServiceAtCounter(tx, previous.id);
        await tx.counter.update({ where: { id: previous.id }, data: { staffId: null } });
      }
      const updated = await tx.counter.update({ where: { id: counterId }, data: { staffId } });
      return Object.assign(updated, { movedFromCounterId: (previous?.id ?? null) as string | null });
    });
  } catch (err) {
    // P2002 on counters_staff_id_key: another transaction gave this operator
    // a counter between our read and our write.
    if (isUniqueViolation(err, 'staffId')) {
      throw alreadyAssigned();
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
  // Prisma names the violated constraint by field, by column or by index
  // depending on the query path (a write inside an interactive transaction
  // reports the column), so accept any of them.
  const meta = JSON.stringify((err as { meta?: unknown }).meta ?? {});
  const column = field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return meta.includes(field) || meta.includes(column);
}

import type { Counter, CounterStatus, Prisma, Queue } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { assertQueueMutable } from '../utils/tenantScope';
import {
  assertNoActiveServiceAtCounter,
  findAssignedCounter,
  type CounterActor,
} from './counterAccess.service';
import {
  operatorEligibilityWhere,
  requireManageableQueue,
  requireVisibleQueue,
  visibleQueueWhere,
  type WorkspaceActor,
} from './workspaceScope.service';
import type { createCounterSchema, updateCounterSchema } from '../validators/counter.validators';

type CreateCounterInput = z.infer<typeof createCounterSchema.body>;
type UpdateCounterInput = z.infer<typeof updateCounterSchema.body>;

/**
 * ADR-069 counter lifecycle:
 *  - ACTIVE    — serving; an operator is required.
 *  - ON_BREAK  — "Paused": not serving, the operator stays assigned.
 *  - OFFLINE   — "Off": the operator is released. The only state a counter
 *                may be in without an operator.
 * A person called or being served is never separated from their operator:
 * turning the counter off, deleting it or moving its operator is refused
 * until that visit is resolved (ADR-064).
 */
export const COUNTER_OPERATOR_REQUIRED = 'COUNTER_OPERATOR_REQUIRED';

function operatorRequired(): AppError {
  return new AppError(
    409,
    COUNTER_OPERATOR_REQUIRED,
    'A counter needs an assigned operator to be active or paused. Assign someone first.',
  );
}

/**
 * counter → queue → workspace scope — never authorize using counterId alone.
 * A counter in a queue the actor cannot see is "not found".
 */
export async function findCounterScoped(
  actor: WorkspaceActor,
  counterId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<Counter & { queue: Queue }> {
  const counter = await client.counter.findFirst({
    where: { id: counterId, queue: visibleQueueWhere(actor) },
    include: { queue: true },
  });

  if (!counter) {
    throw new AppError(404, 'COUNTER_NOT_FOUND', 'Counter not found.');
  }

  return counter;
}

async function findManageableCounter(actor: WorkspaceActor, counterId: string) {
  const counter = await findCounterScoped(actor, counterId);
  await requireManageableQueue(actor, counter.queueId);
  assertQueueMutable(counter.queue);
  return counter;
}

const COUNTER_INCLUDE = {
  staff: { select: { id: true, name: true, role: true } },
  services: { select: { serviceId: true } },
} as const;

type CounterWithDetail = Prisma.CounterGetPayload<{ include: typeof COUNTER_INCLUDE }>;

/** The counter as the dashboard shows it: who operates it, and which
 * services it handles (an empty list means every service of its queue). */
function serializeCounter(counter: CounterWithDetail) {
  const { services, staff, ...rest } = counter;
  return {
    ...rest,
    operator: staff ? { id: staff.id, name: staff.name, role: staff.role } : null,
    serviceIds: services.map((s) => s.serviceId),
  };
}

export async function listCounters(actor: WorkspaceActor, queueId: string) {
  await requireVisibleQueue(actor, queueId);
  const counters = await prisma.counter.findMany({
    where: { queueId },
    orderBy: { createdAt: 'asc' },
    include: COUNTER_INCLUDE,
  });
  return counters.map(serializeCounter);
}

/** Whether `staffId` may operate a counter of `queue` (ADR-069 D7). */
async function assertEligibleOperator(
  tx: Prisma.TransactionClient,
  queue: Pick<Queue, 'adminId' | 'organizationId'>,
  staffId: string,
) {
  const eligible = await tx.staff.findFirst({
    where: { AND: [{ id: staffId }, operatorEligibilityWhere(queue)] },
    select: { id: true },
  });
  if (!eligible) {
    throw new AppError(
      409,
      'OPERATOR_NOT_ASSIGNABLE',
      queue.adminId
        ? "Only this queue's Admin or one of their active Executives can operate its counters."
        : 'Only the Organization Head or an organization-level Executive can operate this counter.',
    );
  }
}

export async function createCounter(actor: CounterActor, queueId: string, input: CreateCounterInput) {
  const queue = await requireManageableQueue(actor, queueId);
  assertQueueMutable(queue);
  const operatorStaffId = input.operatorStaffId ?? null;
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (operatorStaffId) {
        await assertEligibleOperator(tx, queue, operatorStaffId);
        const busy = await tx.counter.findUnique({ where: { staffId: operatorStaffId }, include: { queue: true } });
        if (busy) throw alreadyAssigned({ counterName: busy.name, queueName: busy.queue.name });
      }
      return tx.counter.create({
        data: {
          queueId,
          name: input.name,
          // ADR-069: a counter is born active with its operator, or off.
          status: operatorStaffId ? 'ACTIVE' : 'OFFLINE',
          staffId: operatorStaffId,
        },
        include: COUNTER_INCLUDE,
      });
    });
    return serializeCounter(created);
  } catch (err) {
    if (isUniqueViolation(err, 'staffId')) throw alreadyAssigned();
    throw err;
  }
}

export async function updateCounter(actor: CounterActor, counterId: string, input: UpdateCounterInput) {
  await findManageableCounter(actor, counterId);
  const updated = await prisma.counter.update({
    where: { id: counterId },
    data: { name: input.name },
    include: COUNTER_INCLUDE,
  });
  return serializeCounter(updated);
}

/**
 * Pause, turn off or (re)activate. Turning a counter off releases its
 * operator in the same write; activating or pausing needs one. An operator
 * may be given with ACTIVE to reactivate an off counter in one step.
 */
export async function setCounterStatus(
  actor: CounterActor,
  counterId: string,
  status: CounterStatus,
  operatorStaffId?: string | null,
) {
  await findManageableCounter(actor, counterId);
  if (operatorStaffId && status !== 'OFFLINE') {
    // Reactivating with an operator: assign (an off counter becomes paused),
    // then set the requested status below.
    await assignCounter(actor, counterId, operatorStaffId);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ staff_id: string | null }[]>`
      SELECT staff_id FROM counters WHERE id = ${counterId} FOR UPDATE
    `;
    const staffId = rows[0]?.staff_id ?? null;
    if (status === 'OFFLINE') {
      await assertNoActiveServiceAtCounter(tx, counterId);
      return tx.counter.update({
        where: { id: counterId },
        data: { status: 'OFFLINE', staffId: null },
        include: COUNTER_INCLUDE,
      });
    }
    if (!staffId) throw operatorRequired();
    return tx.counter.update({ where: { id: counterId }, data: { status }, include: COUNTER_INCLUDE });
  });
  return serializeCounter(updated);
}

/** Returns the deleted counter's queue id so the caller can recompute that
 * queue's ETAs — removing an ACTIVE counter changes serving capacity. */
export async function deleteCounter(actor: CounterActor, counterId: string) {
  const counter = await findManageableCounter(actor, counterId);
  await prisma.$transaction(async (tx) => {
    // ADR-064: never orphan a person who is called or being served here.
    await assertNoActiveServiceAtCounter(tx, counterId);
    // ADR-069: a queue keeps at least one counter.
    const remaining = await tx.counter.count({ where: { queueId: counter.queueId } });
    if (remaining <= 1) {
      throw new AppError(
        409,
        'QUEUE_NEEDS_A_COUNTER',
        'A queue needs at least one counter. Add another counter before deleting this one.',
      );
    }
    await tx.counter.delete({ where: { id: counterId } });
  });
  return { queueId: counter.queueId };
}

/**
 * ADR-070: which services this counter handles. An empty list restores the
 * default — every service of its queue. Every id must be a service of this
 * counter's own queue.
 */
export async function setCounterServices(actor: CounterActor, counterId: string, serviceIds: string[]) {
  const counter = await findManageableCounter(actor, counterId);
  const unique = [...new Set(serviceIds)];
  if (unique.length > 0) {
    const found = await prisma.queueService.count({ where: { id: { in: unique }, queueId: counter.queueId } });
    if (found !== unique.length) {
      throw new AppError(404, 'SERVICE_NOT_FOUND', 'One or more services do not belong to this queue.');
    }
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.counterService.deleteMany({ where: { counterId } });
    if (unique.length > 0) {
      await tx.counterService.createMany({ data: unique.map((serviceId) => ({ counterId, serviceId })) });
    }
    return tx.counter.findUniqueOrThrow({ where: { id: counterId }, include: COUNTER_INCLUDE });
  });
  return serializeCounter(updated);
}

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
 * Everyone who could stand at this counter (ADR-069 D7): the queue's Admin
 * and that Admin's active Executives — or, for a legacy queue without an
 * Admin, the Organization Head and organization-level Executives — with where
 * each stands now, so the dashboard can offer an explicit Move rather than a
 * silent replacement.
 */
export async function listAssignableStaff(actor: WorkspaceActor, counterId: string) {
  const counter = await findCounterScoped(actor, counterId);
  await requireManageableQueue(actor, counter.queueId);

  const members = await prisma.staff.findMany({
    where: operatorEligibilityWhere(counter.queue),
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
  actor: WorkspaceActor,
  counterId: string,
  staffId: string | null,
  options: { move?: boolean } = {},
) {
  const counter = await findManageableCounter(actor, counterId);

  // Re-assigning the same person is a no-op; anything that takes the
  // current operator away from this counter must not orphan their visit.
  const changesHolder = counter.staffId !== null && counter.staffId !== staffId;

  if (staffId === null) {
    // ADR-069: only an off counter may be without an operator, and turning a
    // counter off is what releases one. An active or paused counter is never
    // simply emptied.
    if (counter.status !== 'OFFLINE') {
      throw new AppError(
        409,
        'COUNTER_MUST_BE_OFF',
        'Turn the counter off to release its operator. An active or paused counter always has one.',
      );
    }
    return prisma.$transaction(async (tx) => {
      if (changesHolder) await assertNoActiveServiceAtCounter(tx, counterId);
      const updated = await tx.counter.update({
        where: { id: counterId },
        data: { staffId: null },
        include: COUNTER_INCLUDE,
      });
      return Object.assign(serializeCounter(updated), { movedFromCounterId: null as string | null });
    });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await assertEligibleOperator(tx, counter.queue, staffId);
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
        // ADR-069: the counter they leave has no operator now, so it is off.
        await tx.counter.update({ where: { id: previous.id }, data: { staffId: null, status: 'OFFLINE' } });
      }
      const updated = await tx.counter.update({
        where: { id: counterId },
        // ADR-069: off is the only state without an operator, so an off
        // counter given one becomes paused — staffed, not yet serving —
        // until it is activated. Paused/active counters keep their status.
        data: { staffId, ...(counter.status === 'OFFLINE' ? { status: 'ON_BREAK' as const } : {}) },
        include: COUNTER_INCLUDE,
      });
      return Object.assign(serializeCounter(updated), {
        movedFromCounterId: (previous?.id ?? null) as string | null,
      });
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

/**
 * ADR-069: when someone can no longer operate the counter they hold — they
 * were suspended, removed, became a Manager, changed workspace or role — the
 * counter is turned off and they are released, never left "active" without
 * an eligible operator. Refused (COUNTER_HAS_ACTIVE_SERVICE) while they are
 * calling or serving someone there. With `keepIfEligible`, an operator who
 * may still operate that queue keeps their counter.
 */
export async function releaseOperatorCounter(
  tx: Prisma.TransactionClient,
  staffId: string,
  options: { keepIfEligible?: boolean } = {},
): Promise<void> {
  const held = await tx.counter.findUnique({ where: { staffId }, include: { queue: true } });
  if (!held) return;
  if (options.keepIfEligible) {
    const stillEligible = await tx.staff.findFirst({
      where: { AND: [{ id: staffId }, operatorEligibilityWhere(held.queue)] },
      select: { id: true },
    });
    if (stillEligible) return;
  }
  await assertNoActiveServiceAtCounter(tx, held.id);
  await tx.counter.update({ where: { id: held.id }, data: { staffId: null, status: 'OFFLINE' } });
}

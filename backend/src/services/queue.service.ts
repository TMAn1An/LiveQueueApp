import type { Prisma, Queue, QueueService, QueueStatus, StaffRole } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { actorFromAuth, loadActorSnapshot, personSnapshot, recordGovernanceEvent } from './audit.service';
import { resolveQueueTimezone, resolveRepeatPolicy } from './queueIdentityPolicy.service';
import { requireScheduleTimezone } from './queueSchedule.service';
import { AppError } from '../utils/AppError';
import { assertQueueMutable } from '../utils/tenantScope';
import type { createQueueSchema, updateQueueSchema } from '../validators/queue.validators';
import {
  isOrganizationWide,
  mayManageQueue,
  operatorEligibilityWhere,
  requireManageableQueue,
  requireVisibleQueue,
  visibleQueueWhereFiltered,
  type WorkspaceActor,
} from './workspaceScope.service';
import { assertNoActiveServiceAtCounter } from './counterAccess.service';

type CreateQueueInput = z.infer<typeof createQueueSchema.body>;
type UpdateQueueInput = z.infer<typeof updateQueueSchema.body>;

type QueueWithServices = Queue & { services: QueueService[] };

const ADMIN_SELECT = { select: { id: true, name: true, email: true } } as const;

type QueueAdminSummary = { id: string; name: string; email: string } | null;

function serializeQueue(queue: QueueWithServices & { admin?: QueueAdminSummary }, actor?: WorkspaceActor) {
  return {
    ...queue,
    // ADR-071 D1: every queue accepts one or more services. Still sent, always
    // true, for released apps and cached portal bundles that read it.
    allowMultipleServices: true,
    services: [...queue.services].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    qrCodeUri: `livequeue://queue/${queue.id}`,
    // ADR-069: what the signed-in person may do with it — the dashboard
    // shows controls from this, the server re-checks every request anyway.
    ...(actor ? { canManage: mayManageQueue(actor, queue) } : {}),
  };
}

async function findQueueOrThrow(actor: WorkspaceActor, queueId: string): Promise<QueueWithServices> {
  await requireVisibleQueue(actor, queueId);
  return prisma.queue.findUniqueOrThrow({
    where: { id: queueId },
    include: { services: true, admin: ADMIN_SELECT },
  });
}

/**
 * Counter count is a DB-level aggregate (Prisma `_count`, a single COUNT
 * subquery per row via one query overall — not one request per queue),
 * used only here to power the dashboard's queue-list "Counters" column
 * (Issue 1: discoverability). No other queue endpoint needs it, so
 * serializeQueue/QueueWithServices stay untouched.
 */
export async function listQueues(actor: WorkspaceActor, filter: { adminId?: string } = {}) {
  const organizationId = actor.organizationId;
  const queues = await prisma.queue.findMany({
    where: { AND: [visibleQueueWhereFiltered(actor, filter.adminId), { deletedAt: null }] },
    include: { services: true, admin: ADMIN_SELECT, _count: { select: { counters: true } } },
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
    ...serializeQueue(queue, actor),
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

export async function getQueue(actor: WorkspaceActor, queueId: string) {
  const queue = await findQueueOrThrow(actor, queueId);
  const waiting = await countWaitingByQueue(actor.organizationId, [queue.id]);
  // The Live Queue header reads this; it was previously only on the list.
  return { ...serializeQueue(queue, actor), waitingCount: waiting.get(queue.id) ?? 0 };
}

/** A token prefix from the queue's name when the creator gives none: its
 * first letter, or Q. Prefixes need not be unique (each queue numbers its
 * own tokens), so nothing more is needed. */
function defaultTokenPrefix(name: string): string {
  const letter = name.trim().match(/[A-Za-z]/)?.[0];
  return (letter ?? 'Q').toUpperCase();
}

/**
 * Whose workspace a new queue goes into (ADR-069 D1): an Admin creates their
 * own; the Organization Head may create one for a named Admin. Nobody else
 * creates queues, and no queue is ever created without an Admin.
 */
async function resolveNewQueueAdmin(
  tx: Prisma.TransactionClient,
  actor: WorkspaceActor,
  requestedAdminId: string | undefined,
) {
  let adminId: string;
  if (actor.role === 'ADMIN') {
    if (requestedAdminId && requestedAdminId !== actor.staffId) {
      throw new AppError(403, 'QUEUE_MANAGEMENT_FORBIDDEN', 'An Admin can only create their own queue.');
    }
    adminId = actor.staffId;
  } else if (actor.role === 'OWNER') {
    if (!requestedAdminId) {
      throw new AppError(422, 'QUEUE_ADMIN_REQUIRED', 'Choose the Admin whose queue this is.');
    }
    adminId = requestedAdminId;
  } else {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
  }
  const admin = await tx.staff.findFirst({
    where: { id: adminId, organizationId: actor.organizationId, role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  if (!admin) {
    throw new AppError(404, 'ADMIN_NOT_FOUND', 'That Admin could not be found.');
  }
  // ADR-069: one Admin, one queue. The partial unique index enforces it too;
  // this check exists to give the friendly answer.
  const existing = await tx.queue.findFirst({ where: { adminId, deletedAt: null }, select: { name: true } });
  if (existing) {
    throw new AppError(
      409,
      'ADMIN_ALREADY_HAS_QUEUE',
      actor.role === 'ADMIN'
        ? `You already have a queue (${existing.name}). Each Admin runs one queue.`
        : `This Admin already has a queue (${existing.name}). Each Admin runs one queue.`,
    );
  }
  return adminId;
}

/** The operator chosen for a queue's first counter: the queue's Admin
 * ("Assign myself", the default) or one of that Admin's Executives. */
async function resolveFirstCounterOperator(
  tx: Prisma.TransactionClient,
  queue: { adminId: string; organizationId: string },
  operatorStaffId: string | null | undefined,
): Promise<string> {
  const staffId = operatorStaffId ?? queue.adminId;
  const eligible = await tx.staff.findFirst({
    where: { AND: [{ id: staffId }, operatorEligibilityWhere(queue)] },
    select: { id: true },
  });
  if (!eligible) {
    throw new AppError(
      422,
      'OPERATOR_NOT_ASSIGNABLE',
      'Choose yourself or one of your active Executives to operate this counter.',
    );
  }
  const busy = await tx.counter.findUnique({
    where: { staffId },
    select: { name: true, queue: { select: { name: true } } },
  });
  if (busy) {
    throw new AppError(
      409,
      'OPERATOR_ALREADY_ASSIGNED',
      `This person is already assigned to ${busy.name} (${busy.queue.name}). Choose someone else, or release them there first.`,
    );
  }
  return staffId;
}

export async function createQueue(actor: WorkspaceActor, input: CreateQueueInput) {
  const organizationId = actor.organizationId;
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

  // ADR-069: the queue, its first counter and that counter's operator are
  // created together or not at all — a new queue never exists without a
  // working counter, and a counter is never active without an operator.
  const queue = await prisma.$transaction(async (tx) => {
    const adminId = await resolveNewQueueAdmin(tx, actor, input.adminId);
    const firstCounter = input.firstCounter ?? {};
    const operatorId = await resolveFirstCounterOperator(
      tx,
      { adminId, organizationId },
      firstCounter.operatorStaffId,
    );
    const created = await tx.queue.create({
    data: {
      organizationId,
      adminId,
      name: input.name,
      description: input.description,
      clientTerminology: input.clientTerminology,
      tokenPrefix: input.tokenPrefix ?? defaultTokenPrefix(input.name),
      startingNumber: input.startingNumber,
      nextTokenNumber: input.startingNumber,
      baseTimeMinutes: input.baseTimeMinutes,
      defaultNotificationMinutes: input.defaultNotificationMinutes,
      status: input.status,
      // ADR-071 D1: always true; the column is kept only for compatibility.
      allowMultipleServices: true,
      requireServiceStartOtp: input.requireServiceStartOtp,
      timezone,
      ...policy,
    },
    });
    await tx.counter.create({
      data: {
        queueId: created.id,
        name: firstCounter.name?.trim() || 'Counter 1',
        status: 'ACTIVE',
        staffId: operatorId,
      },
    });
    return tx.queue.findUniqueOrThrow({
      where: { id: created.id },
      include: { services: true, admin: ADMIN_SELECT },
    });
  }).catch((err: unknown) => {
    // Two concurrent creates for one Admin: the partial unique index wins.
    if (isUniqueViolation(err, 'queues_admin_live_key')) {
      throw new AppError(409, 'ADMIN_ALREADY_HAS_QUEUE', 'This Admin already has a queue. Each Admin runs one queue.');
    }
    if (isUniqueViolation(err, 'staff_id')) {
      throw new AppError(409, 'OPERATOR_ALREADY_ASSIGNED', 'This person is already assigned to another counter.');
    }
    throw err;
  });

  return serializeQueue(queue, actor);
}

function isUniqueViolation(err: unknown, target: string): boolean {
  const e = err as { code?: string; meta?: { target?: unknown }; message?: string };
  if (e?.code !== 'P2002') return false;
  const t = e.meta?.target;
  const text = Array.isArray(t) ? t.join(',') : String(t ?? e.message ?? '');
  return text.includes(target);
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
  actor: WorkspaceActor,
  queueId: string,
  input: UpdateQueueInput,
) {
  const organizationId = actor.organizationId;
  await requireManageableQueue(actor, queueId);
  const existing = await findQueueOrThrow(actor, queueId);
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
    include: { services: true, admin: ADMIN_SELECT },
  });

  return serializeQueue(queue, actor);
}

export async function updateQueueStatus(actor: WorkspaceActor, queueId: string, status: QueueStatus) {
  const existing = await requireManageableQueue(actor, queueId);
  assertQueueMutable(existing);

  const queue = await prisma.queue.update({
    where: { id: queueId },
    data: { status },
    include: { services: true, admin: ADMIN_SELECT },
  });

  return serializeQueue(queue, actor);
}

export interface QueueDeletionActor extends WorkspaceActor {
  email: string;
}

/**
 * ADR-069 D8: removing a queue. Always with a reason, which is kept with the
 * queue (who, which role, why) and shown to the people who were waiting in it
 * — and to nobody else.
 *
 *  - Who: the Organization Head or a Manager (any queue in the organization),
 *    or an Admin (their own queue).
 *  - Refused while anyone is called or being served: that visit is finished
 *    first, never cut off.
 *  - Everyone still waiting is cancelled in the same transaction, with
 *    queue-removal as the reason. A cancellation never spends a repeat-visit
 *    allowance (only COMPLETED does); their identity reservations are
 *    released exactly as a cancel by the person would.
 *  - Its counters are turned off and their operators released, so an Admin
 *    can run a new queue.
 *  - Soft delete: tokens, history and reports are kept.
 */
export async function softDeleteQueue(
  actor: QueueDeletionActor,
  queueId: string,
  reason: string,
  ipAddress?: string,
) {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new AppError(422, 'DELETION_REASON_REQUIRED', 'Say why this queue is being deleted.');
  }
  const visible = await requireVisibleQueue(actor, queueId);
  const allowed =
    isOrganizationWide(actor) || (actor.role === 'ADMIN' && visible.adminId === actor.staffId);
  if (!allowed) {
    throw new AppError(403, 'QUEUE_DELETION_FORBIDDEN', 'You cannot delete this queue.');
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ deleted_at: Date | null }[]>`
      SELECT deleted_at FROM queues WHERE id = ${queueId} FOR UPDATE
    `;
    if (!locked[0] || locked[0].deleted_at) {
      assertQueueMutable({ deletedAt: locked[0]?.deleted_at ?? new Date() });
    }
    const serving = await tx.token.count({ where: { queueId, status: { in: ['CALLED', 'IN_PROGRESS'] } } });
    if (serving > 0) {
      throw new AppError(
        409,
        'QUEUE_HAS_ACTIVE_SERVICE',
        'Someone in this queue is being called or served. Finish or skip them first, then delete the queue.',
      );
    }
    const waiting = await tx.token.findMany({ where: { queueId, status: 'WAITING' }, select: { id: true } });
    const waitingIds = waiting.map((t) => t.id);
    const now = new Date();
    if (waitingIds.length > 0) {
      await tx.token.updateMany({
        where: { id: { in: waitingIds }, status: 'WAITING' },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReasonCode: 'QUEUE_REMOVED',
          serviceStartOtpCipher: null,
          serviceStartOtpExpiresAt: null,
          serviceStartOtpFailedAttempts: 0,
        },
      });
      await tx.tokenServiceStep.updateMany({
        where: { tokenId: { in: waitingIds }, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      // Same release a cancel by the person performs (ADR-034).
      await tx.queueIdentityClaim.deleteMany({ where: { tokenId: { in: waitingIds } } });
    }
    await tx.counter.updateMany({ where: { queueId }, data: { status: 'OFFLINE', staffId: null } });

    const queue = await tx.queue.update({
      where: { id: queueId },
      data: {
        deletedAt: now,
        deletedByStaffId: actor.staffId,
        deletedByEmail: actor.email,
        deletedByRole: actor.role as StaffRole,
        deletionReason: trimmed,
      },
      include: { services: true, admin: ADMIN_SELECT },
    });
    // ADR-071: the removal and its record (who, role, why) commit together.
    await recordGovernanceEvent(tx, {
      actor: actorFromAuth(actor),
      actorSnapshot: await loadActorSnapshot(tx, actor.staffId),
      action: 'queue_deleted_or_archived',
      entityType: 'queue',
      entityId: queue.id,
      metadata: { name: queue.name, reason: trimmed, cancelledWaiting: waitingIds.length },
      workspaceAdminId: queue.adminId,
      ipAddress,
    });
    return { queue: serializeQueue(queue, actor), cancelledTokenIds: waitingIds };
  });
}

/**
 * ADR-069 D2: the Organization Head hands a queue without an Admin (a legacy
 * Head-managed queue, or one whose Admin left) to an Admin who has none.
 *
 * Operators on its counters: organization-level Executives already serving
 * there join the Admin's workspace (they were already this queue's people);
 * anyone else who could not operate an Admin's queue (the Head, another
 * Admin, another workspace's Executive) is released and that counter turned
 * off — refused while they are serving someone.
 */
export async function assignQueueAdmin(
  actor: WorkspaceActor & { email: string },
  queueId: string,
  adminId: string,
  ipAddress?: string,
) {
  if (actor.role !== 'OWNER') {
    throw new AppError(403, 'FORBIDDEN', 'Only the Organization Head can assign a queue to an Admin.');
  }
  return prisma.$transaction(async (tx) => {
    const queue = await requireVisibleQueue(actor, queueId, tx);
    assertQueueMutable(queue);
    if (queue.adminId) {
      throw new AppError(409, 'QUEUE_ALREADY_HAS_ADMIN', 'This queue already belongs to an Admin.');
    }
    const admin = await tx.staff.findFirst({
      where: { id: adminId, organizationId: actor.organizationId, role: 'ADMIN', status: 'ACTIVE' },
    });
    if (!admin) throw new AppError(404, 'ADMIN_NOT_FOUND', 'That Admin could not be found.');
    const existing = await tx.queue.findFirst({ where: { adminId, deletedAt: null }, select: { name: true } });
    if (existing) {
      throw new AppError(409, 'ADMIN_ALREADY_HAS_QUEUE', `This Admin already has a queue (${existing.name}).`);
    }
    const counters = await tx.counter.findMany({
      where: { queueId, staffId: { not: null } },
      include: { staff: { select: { id: true, role: true, workspaceAdminId: true } } },
    });
    for (const counter of counters) {
      const op = counter.staff!;
      if (op.id === adminId) continue;
      if (op.role === 'STAFF' && (op.workspaceAdminId === null || op.workspaceAdminId === adminId)) {
        if (op.workspaceAdminId === null) {
          await tx.staff.update({ where: { id: op.id }, data: { workspaceAdminId: adminId } });
        }
        continue;
      }
      await assertNoActiveServiceAtCounter(tx, counter.id);
      await tx.counter.update({ where: { id: counter.id }, data: { staffId: null, status: 'OFFLINE' } });
    }
    const updated = await tx.queue.update({
      where: { id: queueId },
      data: { adminId },
      include: { services: true, admin: ADMIN_SELECT },
    });
    await recordGovernanceEvent(tx, {
      actor: actorFromAuth(actor),
      actorSnapshot: await loadActorSnapshot(tx, actor.staffId),
      action: 'queue_updated',
      entityType: 'queue',
      entityId: queueId,
      metadata: { changedFields: ['adminId'], adminId, admin: personSnapshot(admin) },
      workspaceAdminId: adminId,
      ipAddress,
    });
    return serializeQueue(updated, actor);
  });
}

/**
 * ADR-069: removed queues — who removed each, in which role, when and why.
 * The Organization Head and Managers see the whole organization's (optionally
 * one Admin's); an Admin their own.
 */
export async function listDeletedQueues(actor: WorkspaceActor, filter: { adminId?: string } = {}) {
  const queues = await prisma.queue.findMany({
    where: { AND: [visibleQueueWhereFiltered(actor, filter.adminId), { deletedAt: { not: null } }] },
    orderBy: { deletedAt: 'desc' },
    select: {
      id: true,
      name: true,
      deletedAt: true,
      deletedByEmail: true,
      deletedByRole: true,
      deletionReason: true,
      admin: ADMIN_SELECT,
    },
  });
  return queues;
}

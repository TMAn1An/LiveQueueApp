import type { Prisma, Queue, StaffRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

/**
 * ADR-069: the one place that decides which Admin workspace data a signed-in
 * person may see or change. Every staff-facing query that touches a queue —
 * or anything that belongs to one: counters, services, forms, schedules,
 * tokens, reports, service history, audit events — is narrowed here, on the
 * server, so changing an id in a URL, payload or socket message never
 * reaches another workspace.
 *
 *  - Organization Head (OWNER) and Organization Manager (MANAGER) see every
 *    workspace in their organization. Only the Head may change them.
 *  - An Admin sees and manages their own queue (one live queue each).
 *  - An Executive (STAFF) sees their Admin's queue; an organization-level
 *    Executive (no workspace yet) sees the legacy Head-managed queues.
 *  - Anyone may also see the queue of the counter they are assigned to, so
 *    an operator kept on a legacy counter can still serve from it.
 *
 * A queue outside what someone may see is reported as not found, so ids
 * from other workspaces cannot be probed.
 */
export interface WorkspaceActor {
  staffId: string;
  organizationId: string;
  role: StaffRole;
  workspaceAdminId?: string | null;
}

export function isOrganizationWide(actor: Pick<WorkspaceActor, 'role'>): boolean {
  return actor.role === 'OWNER' || actor.role === 'MANAGER';
}

/** The Admin workspace an actor works in: an Admin's own, an Executive's
 * Admin's, or null (organization-wide roles, organization-level Executives). */
export function workspaceOf(actor: WorkspaceActor): string | null {
  if (actor.role === 'ADMIN') return actor.staffId;
  if (actor.role === 'STAFF') return actor.workspaceAdminId ?? null;
  return null;
}

/** The queues this actor's own workspace contains (no counter allowance). */
function ownWorkspaceQueues(actor: WorkspaceActor): Prisma.QueueWhereInput {
  if (actor.role === 'ADMIN') return { adminId: actor.staffId };
  if (actor.role === 'STAFF') {
    return actor.workspaceAdminId ? { adminId: actor.workspaceAdminId } : { adminId: null };
  }
  // Organization-wide roles are handled by the caller; anything else sees none.
  return { id: { in: [] } };
}

/** Prisma filter for the queues an actor may see (deleted ones included —
 * history stays readable; callers add `deletedAt: null` where they need it). */
export function visibleQueueWhere(actor: WorkspaceActor): Prisma.QueueWhereInput {
  if (isOrganizationWide(actor)) return { organizationId: actor.organizationId };
  return {
    organizationId: actor.organizationId,
    OR: [ownWorkspaceQueues(actor), { counters: { some: { staffId: actor.staffId } } }],
  };
}

/** Optional Admin filter for organization-wide readers (Head, Manager):
 * narrows to one Admin's workspace. Ignored for everyone else, whose view is
 * already a single workspace. */
export function visibleQueueWhereFiltered(
  actor: WorkspaceActor,
  adminId?: string | null,
): Prisma.QueueWhereInput {
  const base = visibleQueueWhere(actor);
  if (!adminId || !isOrganizationWide(actor)) return base;
  return { AND: [base, { adminId }] };
}

export async function visibleQueueIds(
  actor: WorkspaceActor,
  adminId?: string | null,
  client: Prisma.TransactionClient = prisma,
): Promise<string[]> {
  const rows = await client.queue.findMany({
    where: visibleQueueWhereFiltered(actor, adminId),
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** Read access: the queue, or 404 QUEUE_NOT_FOUND. */
export async function requireVisibleQueue(
  actor: WorkspaceActor,
  queueId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<Queue> {
  const queue = await client.queue.findFirst({ where: { AND: [{ id: queueId }, visibleQueueWhere(actor)] } });
  if (!queue) {
    throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
  }
  return queue;
}

/** Whether an actor may change a queue's configuration (settings, services,
 * form, schedule, counters, routing). The Organization Head may change any
 * queue in the organization (every Owner power is kept); an Admin only their
 * own. Managers and Executives never. */
export function mayManageQueue(actor: WorkspaceActor, queue: Pick<Queue, 'adminId' | 'organizationId'>): boolean {
  if (queue.organizationId !== actor.organizationId) return false;
  if (actor.role === 'OWNER') return true;
  return actor.role === 'ADMIN' && queue.adminId === actor.staffId;
}

/** Configuration access: 404 when the queue is not even visible, 403 when it
 * is visible but not this person's to change. */
export async function requireManageableQueue(
  actor: WorkspaceActor,
  queueId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<Queue> {
  const queue = await requireVisibleQueue(actor, queueId, client);
  if (!mayManageQueue(actor, queue)) {
    throw new AppError(403, 'QUEUE_MANAGEMENT_FORBIDDEN', 'You cannot change this queue.');
  }
  return queue;
}

/** Prisma filter for the staff an actor may see. */
export function visibleStaffWhere(actor: WorkspaceActor): Prisma.StaffWhereInput {
  if (isOrganizationWide(actor)) return { organizationId: actor.organizationId };
  if (actor.role === 'ADMIN') {
    return {
      organizationId: actor.organizationId,
      OR: [{ id: actor.staffId }, { workspaceAdminId: actor.staffId }],
    };
  }
  return { organizationId: actor.organizationId, id: actor.staffId };
}

/**
 * Who may operate a counter of this queue (ADR-069 D7): the queue's Admin and
 * the Executives of that Admin's workspace. A legacy Head-managed queue keeps
 * the old arrangement: the Organization Head and organization-level
 * Executives. Managers never serve.
 */
export function operatorEligibilityWhere(queue: Pick<Queue, 'adminId' | 'organizationId'>): Prisma.StaffWhereInput {
  if (queue.adminId) {
    return {
      organizationId: queue.organizationId,
      status: 'ACTIVE',
      OR: [
        { id: queue.adminId, role: 'ADMIN' },
        { role: 'STAFF', workspaceAdminId: queue.adminId },
      ],
    };
  }
  return {
    organizationId: queue.organizationId,
    status: 'ACTIVE',
    OR: [{ role: 'OWNER' }, { role: 'STAFF', workspaceAdminId: null }],
  };
}

/** ADR-069: the Admin workspace a queue belongs to (null: no Admin), for
 * attributing audit events about it. */
export async function workspaceOfQueue(queueId: string): Promise<string | null> {
  const queue = await prisma.queue.findUnique({ where: { id: queueId }, select: { adminId: true } });
  return queue?.adminId ?? null;
}

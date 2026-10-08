import type { AdminTransferOutcome, Prisma, Staff } from '@prisma/client';
import { prisma } from '../config/prisma';
import { getEffectivePermissions } from '../constants/permissions';
import { AppError } from '../utils/AppError';
import { actorFromAuth, loadActorSnapshot, personSnapshot, recordGovernanceEvent } from './audit.service';
import { assertNoActiveServiceForStaff } from './counterAccess.service';
import { releaseOperatorCounter } from './counter.service';
import { lockOrganization, lockStaffRows } from './governance.service';
import type { GovernanceActor } from './staff.service';

/**
 * ADR-071: handing an Admin's workspace to a replacement Admin.
 *
 * Every live queue keeps exactly one Admin, so an Admin who owns one (or
 * still has Executives) leaves the role only through this transfer:
 *
 *  - the queue changes owner — its id, counters, services, routing,
 *    recommended order, tokens, history, reports and QR are untouched;
 *  - every Executive of the old workspace, invited or active, moves to the
 *    replacement's workspace;
 *  - counter operators stay where they still may operate; anyone who no
 *    longer may is released (refused while they are serving someone);
 *  - the replacement is promoted to Admin if needed, and the old Admin
 *    becomes an Organization Manager, an Executive of the new workspace, or
 *    leaves the organization;
 *  - an immutable AdminWorkspaceTransfer row and the audit event are written
 *    in the same transaction.
 *
 * Earlier audit rows keep the Admin who performed them (ADR-071 D3): the new
 * Admin sees the queue's operational history, and the handover event itself,
 * but does not inherit the predecessor's audit trail.
 */

export type TransferOutcomeInput = 'MANAGER' | 'EXECUTIVE' | 'REMOVE';

export interface WorkspaceTransferInput {
  replacementStaffId: string;
  outcome: TransferOutcomeInput;
  reason: string;
  note?: string;
}

function requireHead(actor: GovernanceActor): void {
  if (actor.role !== 'OWNER') {
    throw new AppError(403, 'FORBIDDEN', 'Only the Organization Head can hand over an Admin workspace.');
  }
}

async function findAdmin(client: Prisma.TransactionClient, organizationId: string, adminId: string): Promise<Staff> {
  const admin = await client.staff.findFirst({ where: { id: adminId, organizationId } });
  if (!admin) throw new AppError(404, 'STAFF_NOT_FOUND', 'Associate not found.');
  if (admin.role !== 'ADMIN') {
    throw new AppError(422, 'NOT_AN_ADMIN', 'Only an Admin has a workspace to hand over.');
  }
  return admin;
}

/** Who can take over: an ACTIVE Admin without a live queue, or an ACTIVE
 * Organization Manager or Executive (promoted to Admin by the transfer).
 * Never the Head, an invitee who has not accepted, or a suspended account. */
async function eligibleReplacementWhere(organizationId: string, oldAdminId: string): Promise<Prisma.StaffWhereInput> {
  const busyAdmins = await prisma.queue.findMany({
    where: { organizationId, deletedAt: null, adminId: { not: null } },
    select: { adminId: true },
  });
  return {
    organizationId,
    status: 'ACTIVE',
    id: { notIn: [oldAdminId, ...busyAdmins.map((q) => q.adminId!)] },
    role: { in: ['ADMIN', 'MANAGER', 'STAFF'] },
  };
}

/**
 * What changing this person's role would affect — so the dashboard can guide
 * the Head into the replacement flow instead of failing. Head only.
 */
export async function roleChangeImpact(actor: GovernanceActor, staffId: string) {
  requireHead(actor);
  const target = await prisma.staff.findFirst({ where: { id: staffId, organizationId: actor.organizationId } });
  if (!target) throw new AppError(404, 'STAFF_NOT_FOUND', 'Associate not found.');
  const [liveQueue, executiveCount, counter] = await Promise.all([
    target.role === 'ADMIN'
      ? prisma.queue.findFirst({ where: { adminId: target.id, deletedAt: null }, select: { id: true, name: true } })
      : null,
    target.role === 'ADMIN' ? prisma.staff.count({ where: { workspaceAdminId: target.id } }) : 0,
    prisma.counter.findUnique({ where: { staffId: target.id }, select: { id: true, name: true, queueId: true } }),
  ]);
  const activeService = counter
    ? (await prisma.token.count({ where: { counterId: counter.id, status: { in: ['CALLED', 'IN_PROGRESS'] } } })) > 0
    : false;
  const requiresReplacement = target.role === 'ADMIN' && (liveQueue !== null || executiveCount > 0);
  const replacements = requiresReplacement
    ? await prisma.staff.findMany({
        where: await eligibleReplacementWhere(actor.organizationId, target.id),
        select: { id: true, name: true, email: true, role: true, workspaceAdminId: true },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
      })
    : [];
  return {
    staff: { id: target.id, name: target.name, role: target.role },
    liveQueue,
    executiveCount,
    holdsCounter: counter !== null,
    activeService,
    requiresReplacement,
    eligibleReplacements: replacements,
  };
}

const OUTCOME: Record<TransferOutcomeInput, AdminTransferOutcome> = {
  MANAGER: 'MANAGER',
  EXECUTIVE: 'EXECUTIVE',
  REMOVE: 'REMOVED',
};

export async function transferAdminWorkspace(
  actor: GovernanceActor,
  oldAdminId: string,
  input: WorkspaceTransferInput,
  ipAddress?: string,
) {
  requireHead(actor);
  const organizationId = actor.organizationId;
  if (input.replacementStaffId === oldAdminId) {
    throw new AppError(422, 'REPLACEMENT_ADMIN_NOT_ELIGIBLE', 'Choose someone other than the current Admin.');
  }

  return prisma.$transaction(async (tx) => {
    // 1–4: lock the organization, both people and the queue, then decide on
    // what is current under those locks.
    await lockOrganization(tx, organizationId);
    await lockStaffRows(tx, organizationId, [oldAdminId, input.replacementStaffId]);
    const oldAdmin = await findAdmin(tx, organizationId, oldAdminId);
    const replacement = await tx.staff.findFirst({ where: { id: input.replacementStaffId, organizationId } });
    if (!replacement) throw new AppError(404, 'STAFF_NOT_FOUND', 'Associate not found.');
    if (replacement.role === 'OWNER' || replacement.status !== 'ACTIVE') {
      throw new AppError(
        409,
        'REPLACEMENT_ADMIN_NOT_ELIGIBLE',
        replacement.status === 'PENDING_EMAIL_VERIFICATION'
          ? `${replacement.name} has not accepted their invitation yet.`
          : `${replacement.name} cannot take over this workspace.`,
      );
    }
    const lockedQueues = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM queues
      WHERE organization_id = ${organizationId} AND admin_id IN (${oldAdmin.id}, ${replacement.id}) AND deleted_at IS NULL
      FOR UPDATE
    `;
    const queues = await tx.queue.findMany({
      where: { id: { in: lockedQueues.map((q) => q.id) } },
      select: { id: true, name: true, adminId: true },
    });
    const queue = queues.find((q) => q.adminId === oldAdmin.id) ?? null;
    const replacementQueue = queues.find((q) => q.adminId === replacement.id);
    if (replacementQueue) {
      throw new AppError(
        409,
        'REPLACEMENT_ADMIN_ALREADY_HAS_QUEUE',
        `${replacement.name} already manages ${replacementQueue.name}. Each Admin runs one queue.`,
        { queueId: replacementQueue.id, queueName: replacementQueue.name },
      );
    }

    // The old Admin's own counter: kept only if they stay on as an Executive
    // of this queue's (new) workspace; otherwise released — refused while
    // they are serving someone, so no visit is stranded.
    if (input.outcome !== 'EXECUTIVE') {
      await assertNoActiveServiceForStaff(tx, oldAdmin.id);
    }

    // 5: the replacement becomes the Admin (promoted if needed).
    const promoted = replacement.role !== 'ADMIN';
    const newAdmin = promoted
      ? await tx.staff.update({
          where: { id: replacement.id },
          data: { role: 'ADMIN', permissions: getEffectivePermissions('ADMIN'), workspaceAdminId: null },
        })
      : replacement;

    // 6: the queue changes owner. Nothing else about it changes.
    if (queue) {
      await tx.queue.update({ where: { id: queue.id }, data: { adminId: newAdmin.id } });
    }

    // 7: every Executive of the old workspace — active or still invited —
    // joins the new one.
    const moved = await tx.staff.updateMany({
      where: { organizationId, workspaceAdminId: oldAdmin.id, id: { not: newAdmin.id } },
      data: { workspaceAdminId: newAdmin.id },
    });
    const movedExecutives = await tx.staff.findMany({
      where: { organizationId, workspaceAdminId: newAdmin.id },
      select: { id: true },
    });

    // 8: the old Admin's outcome.
    let oldAfter: Staff | null = null;
    if (input.outcome === 'REMOVE') {
      await releaseOperatorCounter(tx, oldAdmin.id);
      // Nothing is left to decide on open requests about them (as in a
      // normal removal, ADR-057).
      const open = await tx.membershipRemovalRequest.findMany({
        where: { targetStaffId: oldAdmin.id, status: 'PENDING' },
        select: { id: true },
      });
      for (const { id } of open) {
        await tx.membershipRemovalRequest.update({
          where: { id },
          data: { status: 'CANCELLED', activeSlot: id, reviewedAt: new Date() },
        });
      }
      await tx.staff.delete({ where: { id: oldAdmin.id } });
    } else {
      oldAfter = await tx.staff.update({
        where: { id: oldAdmin.id },
        data: {
          role: input.outcome === 'MANAGER' ? 'MANAGER' : 'STAFF',
          permissions: getEffectivePermissions(input.outcome === 'MANAGER' ? 'MANAGER' : 'STAFF'),
          workspaceAdminId: input.outcome === 'EXECUTIVE' ? newAdmin.id : null,
        },
      });
      await releaseOperatorCounter(tx, oldAdmin.id, { keepIfEligible: true });
    }

    // 9: anyone operating a counter of this queue who no longer may is
    // released; everyone who still may keeps their counter.
    await releaseOperatorCounter(tx, newAdmin.id, { keepIfEligible: true });
    if (queue) {
      const operated = await tx.counter.findMany({
        where: { queueId: queue.id, staffId: { not: null } },
        select: { staffId: true },
      });
      for (const { staffId } of operated) {
        await releaseOperatorCounter(tx, staffId!, { keepIfEligible: true });
      }
    }

    // 10–11: immutable history and the audit event, in this transaction.
    const transfer = await tx.adminWorkspaceTransfer.create({
      data: {
        organizationId,
        queueId: queue?.id ?? null,
        queueName: queue?.name ?? null,
        oldAdminId: oldAdmin.id,
        oldAdminName: oldAdmin.name,
        oldAdminEmail: oldAdmin.email,
        oldAdminOutcome: OUTCOME[input.outcome],
        newAdminId: newAdmin.id,
        newAdminName: newAdmin.name,
        newAdminEmail: newAdmin.email,
        newAdminPreviousRole: replacement.role,
        transferredById: actor.staffId,
        transferredByName: (await loadActorSnapshot(tx, actor.staffId))?.name ?? actor.email,
        transferredByEmail: actor.email,
        reason: input.reason.trim(),
        note: input.note?.trim() || null,
        executivesMoved: moved.count,
      },
    });
    await recordGovernanceEvent(tx, {
      actor: actorFromAuth(actor),
      actorSnapshot: await loadActorSnapshot(tx, actor.staffId),
      action: 'admin_workspace_transferred',
      entityType: 'admin_workspace_transfer',
      entityId: transfer.id,
      metadata: {
        queue: queue ? { id: queue.id, name: queue.name } : null,
        oldAdmin: personSnapshot(oldAdmin),
        oldAdminOutcome: transfer.oldAdminOutcome,
        newAdmin: personSnapshot(newAdmin),
        newAdminPreviousRole: replacement.role,
        executivesMoved: moved.count,
        reason: transfer.reason,
        ...(transfer.note ? { note: transfer.note } : {}),
      },
      // The handover belongs to the workspace it now lives in, so the new
      // Admin sees that it happened (ADR-071 D3).
      workspaceAdminId: newAdmin.id,
      ipAddress,
    });

    return {
      transfer: serializeTransfer(transfer),
      queueId: queue?.id ?? null,
      promoted,
      oldAdmin: oldAfter ? { id: oldAfter.id, role: oldAfter.role } : { id: oldAdmin.id, role: null },
      /** Everyone whose rooms changed: their sockets are closed after commit. */
      affectedStaffIds: [oldAdmin.id, newAdmin.id, ...movedExecutives.map((e) => e.id)],
    };
  });
}

function serializeTransfer(t: {
  id: string;
  queueId: string | null;
  queueName: string | null;
  oldAdminId: string;
  oldAdminName: string;
  oldAdminOutcome: AdminTransferOutcome;
  newAdminId: string;
  newAdminName: string;
  newAdminPreviousRole: string;
  transferredByName: string;
  reason: string;
  note: string | null;
  executivesMoved: number;
  createdAt: Date;
}) {
  return {
    id: t.id,
    queue: t.queueId ? { id: t.queueId, name: t.queueName ?? '' } : null,
    oldAdmin: { id: t.oldAdminId, name: t.oldAdminName, outcome: t.oldAdminOutcome },
    newAdmin: { id: t.newAdminId, name: t.newAdminName, previousRole: t.newAdminPreviousRole },
    transferredByName: t.transferredByName,
    reason: t.reason,
    note: t.note,
    executivesMoved: t.executivesMoved,
    createdAt: t.createdAt,
  };
}

/** Workspace handovers, newest first. Head and Managers see every one; an
 * Admin sees the ones that handed a workspace to them. */
export async function listWorkspaceTransfers(actor: GovernanceActor) {
  const where: Prisma.AdminWorkspaceTransferWhereInput =
    actor.role === 'OWNER' || actor.role === 'MANAGER'
      ? { organizationId: actor.organizationId }
      : actor.role === 'ADMIN'
        ? { organizationId: actor.organizationId, newAdminId: actor.staffId }
        : { organizationId: actor.organizationId, id: { in: [] } };
  const rows = await prisma.adminWorkspaceTransfer.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map(serializeTransfer);
}

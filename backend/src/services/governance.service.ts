import type { Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';

/**
 * ADR-071: shared building blocks for governance changes — role and status
 * changes, removals, Admin workspace transfers, Head succession and
 * organization deletion.
 */

/**
 * Serializes every governance change of one organization: each takes this
 * row lock first, so two of them (a workspace transfer and a role change of
 * the same Admin, a succession acceptance and an organization deletion, …)
 * can never interleave and leave a half-applied state.
 */
export async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE
  `;
  return rows.length === 1;
}

/** Locks the given staff rows of one organization (in id order, so two
 * transactions never wait on each other in opposite orders). */
export async function lockStaffRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  staffIds: string[],
): Promise<void> {
  const ids = [...new Set(staffIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM staff
    WHERE organization_id = ${organizationId} AND id = ANY(${ids}::text[])
    ORDER BY id
    FOR UPDATE
  `;
}

/**
 * ADR-071: every live queue keeps exactly one Admin. An Admin who still owns
 * a live queue cannot leave the Admin role or the organization through an
 * ordinary change — their workspace is handed to a replacement first (or the
 * queue is deleted). An Admin whose workspace still has Executives must have
 * them placed with another Admin the same way, so no new organization-level
 * Executive is ever created by accident.
 */
export async function assertAdminMayLeaveWorkspace(
  tx: Prisma.TransactionClient,
  admin: { id: string; name: string; role: string },
): Promise<void> {
  if (admin.role !== 'ADMIN') return;
  const queue = await tx.queue.findFirst({
    where: { adminId: admin.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (queue) {
    throw new AppError(
      409,
      'ADMIN_OWNS_LIVE_QUEUE',
      `${admin.name} currently manages ${queue.name}. Choose a replacement Admin before changing this role.`,
      { queueId: queue.id, queueName: queue.name },
    );
  }
  const executiveCount = await tx.staff.count({ where: { workspaceAdminId: admin.id } });
  if (executiveCount > 0) {
    throw new AppError(
      409,
      'ADMIN_HAS_EXECUTIVES',
      `${admin.name} still has Executives in their workspace. Hand the workspace to a replacement Admin first.`,
      { executiveCount },
    );
  }
}

/**
 * Ends every session of an account at once: refresh sessions are revoked and
 * access tokens issued before now are refused on every path (REST, optional
 * auth and Socket.io — see utils/authContext.ts). Open sockets are closed by
 * the caller after commit (realtime.disconnectStaff).
 */
export async function revokeAllAccess(tx: Prisma.TransactionClient, staffId: string, now = new Date()): Promise<void> {
  await tx.staff.update({ where: { id: staffId }, data: { accessRevokedAt: now } });
  await tx.session.updateMany({ where: { staffId, revokedAt: null }, data: { revokedAt: now } });
}

/**
 * ADR-071 D8: an organization's detailed audit rows go with it. Called in
 * the same transaction, right after the organization row is deleted — the
 * append-only trigger allows deleting audit rows only once their
 * organization no longer exists, so this can never purge a live
 * organization's history. (Governance tables go by FK cascade.)
 */
export async function purgeDeletedOrganizationsAudit(
  tx: Prisma.TransactionClient,
  organizationIds: string[],
): Promise<void> {
  if (organizationIds.length === 0) return;
  await tx.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
}

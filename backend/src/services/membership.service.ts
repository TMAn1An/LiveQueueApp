import { Prisma, type MembershipRemovalRequest, type Staff, type StaffRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

/**
 * ADR-057: who may end whose membership, and how.
 *
 *              | remove directly         | ask the owner to remove
 * ------------ | ----------------------- | -----------------------------
 * OWNER        | any ADMIN or STAFF      | — (removes directly)
 * ADMIN        | any STAFF               | themselves, or another ADMIN
 * STAFF        | nobody                  | themselves only
 *
 * Nobody removes themselves directly, and nobody may act against the OWNER;
 * an owner who wants out deletes the organization instead. Every rule here
 * is enforced on the server — the dashboard only mirrors it.
 */

export interface MembershipActor {
  staffId: string;
  organizationId: string;
  role: StaffRole;
}

export function serializeRemovalRequest(request: MembershipRemovalRequest) {
  return {
    id: request.id,
    requestType: request.requestType,
    status: request.status,
    reason: request.reason,
    requester: { id: request.requesterId, name: request.requesterName, email: request.requesterEmail },
    target: {
      id: request.targetStaffId,
      name: request.targetName,
      email: request.targetEmail,
      role: request.targetRole,
    },
    reviewedAt: request.reviewedAt,
    reviewedBy: request.reviewedById
      ? { id: request.reviewedById, name: request.reviewedByName }
      : null,
    reviewNote: request.reviewNote,
    createdAt: request.createdAt,
  };
}

async function findMember(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  staffId: string,
): Promise<Staff> {
  const staff = await client.staff.findFirst({ where: { id: staffId, organizationId } });
  if (!staff) {
    throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff member not found.');
  }
  return staff;
}

/** The direct-removal rules, shared by DELETE /api/staff/:id and approval. */
function assertMayRemoveDirectly(actor: MembershipActor, target: Staff): void {
  if (target.id === actor.staffId) {
    throw new AppError(
      403,
      'CANNOT_REMOVE_SELF',
      actor.role === 'OWNER'
        ? 'The owner cannot leave the organization. Delete the organization instead.'
        : 'You cannot remove yourself. Send a leave request to the owner instead.',
    );
  }
  if (target.role === 'OWNER') {
    throw new AppError(403, 'CANNOT_DELETE_OWNER', 'The organization owner cannot be deleted.');
  }
  if (actor.role === 'OWNER') return;
  if (actor.role === 'ADMIN' && target.role === 'STAFF') return;
  if (actor.role === 'ADMIN' && target.role === 'ADMIN') {
    throw new AppError(
      403,
      'REMOVAL_REQUIRES_OWNER_APPROVAL',
      'Only the owner can remove an admin. Send a removal request to the owner instead.',
    );
  }
  throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
}

/**
 * Ends a membership inside `tx`: deletes the Staff row — which cascades to
 * every refresh session, so no token can be refreshed — and closes any other
 * open request about the same person, since there is nothing left to decide.
 * The access check in `authenticate` reads the Staff row on every request,
 * so an outstanding access token stops working at once too.
 */
async function endMembership(
  tx: Prisma.TransactionClient,
  target: Staff,
  exceptRequestId?: string,
): Promise<void> {
  const open = await tx.membershipRemovalRequest.findMany({
    where: {
      targetStaffId: target.id,
      status: 'PENDING',
      ...(exceptRequestId ? { id: { not: exceptRequestId } } : {}),
    },
    select: { id: true },
  });
  for (const { id } of open) {
    await tx.membershipRemovalRequest.update({
      where: { id },
      data: { status: 'CANCELLED', activeSlot: id, reviewedAt: new Date() },
    });
  }
  // deleteMany, not delete: a concurrent removal that got there first leaves
  // nothing to delete, which is reported as "not found" rather than a 500.
  const { count } = await tx.staff.deleteMany({
    where: { id: target.id, organizationId: target.organizationId },
  });
  if (count === 0) {
    throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff member not found.');
  }
}

/** DELETE /api/staff/:staffId. Returns the removed member's snapshot for the audit row. */
export async function removeMember(actor: MembershipActor, targetStaffId: string) {
  return prisma.$transaction(async (tx) => {
    const target = await findMember(tx, actor.organizationId, targetStaffId);
    assertMayRemoveDirectly(actor, target);
    await endMembership(tx, target);
    return { id: target.id, email: target.email, role: target.role };
  });
}

export async function createRemovalRequest(
  actor: MembershipActor,
  input: { targetStaffId: string; reason?: string },
) {
  const [requester, target] = await Promise.all([
    findMember(prisma, actor.organizationId, actor.staffId),
    findMember(prisma, actor.organizationId, input.targetStaffId),
  ]);

  const isSelf = target.id === actor.staffId;

  if (actor.role === 'OWNER') {
    throw new AppError(
      403,
      isSelf ? 'CANNOT_REMOVE_SELF' : 'OWNER_REMOVES_DIRECTLY',
      isSelf
        ? 'The owner cannot leave the organization. Delete the organization instead.'
        : 'As the owner, remove this member directly.',
    );
  }
  if (target.role === 'OWNER') {
    throw new AppError(
      403,
      'CANNOT_REQUEST_OWNER_REMOVAL',
      'The organization owner cannot be removed.',
    );
  }
  if (!isSelf && actor.role === 'STAFF') {
    throw new AppError(403, 'FORBIDDEN', 'Staff members can only request to leave themselves.');
  }
  if (!isSelf && target.role === 'STAFF') {
    // An admin removes staff directly; a request would only wait on the owner
    // for something the admin is already allowed to do.
    throw new AppError(
      422,
      'REMOVAL_REQUEST_NOT_NEEDED',
      'Admins can remove staff members directly.',
    );
  }

  const requestType = isSelf ? 'SELF_LEAVE' : 'ADMIN_REMOVAL_REQUEST';
  try {
    const request = await prisma.membershipRemovalRequest.create({
      data: {
        organizationId: actor.organizationId,
        requestType,
        reason: input.reason || null,
        requesterId: requester.id,
        requesterName: requester.name,
        requesterEmail: requester.email,
        targetStaffId: target.id,
        targetName: target.name,
        targetEmail: target.email,
        targetRole: target.role,
      },
    });
    return serializeRemovalRequest(request);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(
        409,
        'REMOVAL_REQUEST_ALREADY_PENDING',
        isSelf
          ? 'You already have a leave request waiting for the owner.'
          : 'A removal request for this admin is already waiting for the owner.',
      );
    }
    throw err;
  }
}

/** The owner sees every request in the organization; anyone else sees the
 * ones they made and the ones about them. */
export async function listRemovalRequests(
  actor: MembershipActor,
  status?: MembershipRemovalRequest['status'],
) {
  const requests = await prisma.membershipRemovalRequest.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(status ? { status } : {}),
      ...(actor.role === 'OWNER'
        ? {}
        : { OR: [{ requesterId: actor.staffId }, { targetStaffId: actor.staffId }] }),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return requests.map(serializeRemovalRequest);
}

function assertOwner(actor: MembershipActor): void {
  if (actor.role !== 'OWNER') {
    throw new AppError(403, 'OWNER_ONLY', 'Only the organization owner can review requests.');
  }
}

async function findRequest(
  tx: Prisma.TransactionClient,
  organizationId: string,
  requestId: string,
): Promise<MembershipRemovalRequest> {
  // FOR UPDATE: two owner tabs approving and rejecting at once serialize on
  // the row, so exactly one decision wins and the other sees it closed.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM membership_removal_requests
    WHERE id = ${requestId} AND organization_id = ${organizationId}
    FOR UPDATE
  `;
  const request = rows[0]
    ? await tx.membershipRemovalRequest.findUnique({ where: { id: rows[0].id } })
    : null;
  if (!request) {
    throw new AppError(404, 'REMOVAL_REQUEST_NOT_FOUND', 'Request not found.');
  }
  if (request.status !== 'PENDING') {
    throw new AppError(409, 'REMOVAL_REQUEST_NOT_PENDING', 'This request has already been closed.');
  }
  return request;
}

async function closeRequest(
  tx: Prisma.TransactionClient,
  request: MembershipRemovalRequest,
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  reviewer: { id: string; name: string } | null,
  reviewNote?: string,
) {
  return tx.membershipRemovalRequest.update({
    where: { id: request.id },
    data: {
      status,
      activeSlot: request.id,
      reviewedAt: new Date(),
      reviewedById: reviewer?.id ?? null,
      reviewedByName: reviewer?.name ?? null,
      reviewNote: reviewNote || null,
    },
  });
}

export async function approveRemovalRequest(
  actor: MembershipActor,
  requestId: string,
  reviewNote?: string,
) {
  assertOwner(actor);
  return prisma.$transaction(async (tx) => {
    const request = await findRequest(tx, actor.organizationId, requestId);
    const owner = await findMember(tx, actor.organizationId, actor.staffId);
    const target = await tx.staff.findFirst({
      where: { id: request.targetStaffId, organizationId: actor.organizationId },
    });
    if (!target) {
      // Already gone some other way — nothing to approve, so the request is
      // closed as moot rather than left pending forever.
      const closed = await closeRequest(tx, request, 'CANCELLED', null);
      return { request: serializeRemovalRequest(closed), removed: null };
    }
    // The owner's own direct-removal rules still apply (never the owner).
    assertMayRemoveDirectly(actor, target);
    const approved = await closeRequest(
      tx,
      request,
      'APPROVED',
      { id: owner.id, name: owner.name },
      reviewNote,
    );
    await endMembership(tx, target, request.id);
    return {
      request: serializeRemovalRequest(approved),
      removed: { id: target.id, email: target.email, role: target.role },
    };
  });
}

export async function rejectRemovalRequest(
  actor: MembershipActor,
  requestId: string,
  reviewNote?: string,
) {
  assertOwner(actor);
  return prisma.$transaction(async (tx) => {
    const request = await findRequest(tx, actor.organizationId, requestId);
    const owner = await findMember(tx, actor.organizationId, actor.staffId);
    const rejected = await closeRequest(
      tx,
      request,
      'REJECTED',
      { id: owner.id, name: owner.name },
      reviewNote,
    );
    return serializeRemovalRequest(rejected);
  });
}

/** Only the person who made a request may withdraw it. */
export async function cancelRemovalRequest(actor: MembershipActor, requestId: string) {
  return prisma.$transaction(async (tx) => {
    const request = await findRequest(tx, actor.organizationId, requestId);
    if (request.requesterId !== actor.staffId) {
      throw new AppError(403, 'FORBIDDEN', 'Only the person who made this request can withdraw it.');
    }
    const cancelled = await closeRequest(tx, request, 'CANCELLED', null);
    return serializeRemovalRequest(cancelled);
  });
}

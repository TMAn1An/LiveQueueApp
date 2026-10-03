import type { Prisma, Staff, StaffRole } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { assertNoActiveServiceForStaff } from './counterAccess.service';
import { releaseOperatorCounter } from './counter.service';
import { isOrganizationWide, visibleStaffWhere, type WorkspaceActor } from './workspaceScope.service';
import { AppError } from '../utils/AppError';
import { hashPassword } from '../utils/password';
import {
  dispatchInvitation,
  generateInvitationToken,
  resendInvitation,
  unusablePasswordHash,
} from './staffInvitation.service';
import { getEffectivePermissions } from '../constants/permissions';
import type { createStaffSchema, updateStaffSchema } from '../validators/staff.validators';

type CreateStaffInput = z.infer<typeof createStaffSchema.body>;
type UpdateStaffInput = z.infer<typeof updateStaffSchema.body>;

/** Every role name, used to translate a free-text search into an enum filter. */
const STAFF_ROLES: StaffRole[] = ['OWNER', 'ADMIN', 'STAFF', 'MANAGER'];

/** ADR-069: the names people see, so searching "executive" or "head" works. */
const ROLE_LABELS: Record<StaffRole, string> = {
  OWNER: 'organization head',
  MANAGER: 'organization manager',
  ADMIN: 'admin',
  STAFF: 'executive',
};

/**
 * Spec 7.3's "Owner cannot be deleted by normal staff" establishes the
 * OWNER account as protected from ordinary staff-management actions —
 * deletion is the most drastic one, but suspending, demoting, or stripping
 * the owner's permissions via update achieves the same practical outcome
 * (loss of the owner's control over the organization) and is arguably worse,
 * since a suspended owner cannot log back in to undo it. This mirrors
 * deleteStaff's guard exactly: the whole operation is rejected, not just
 * specific fields — consistent with there being no self-service profile
 * endpoint yet (owner renaming was already deferred to a later phase per
 * Phase 1's PROGRESS.md note), so no legitimate flow currently depends on
 * this endpoint being able to touch the owner's record at all.
 */
function assertNotOwner(existing: Pick<Staff, 'role'>): void {
  if (existing.role === 'OWNER') {
    throw new AppError(403, 'CANNOT_MODIFY_OWNER', 'The organization owner cannot be modified this way.');
  }
}

/**
 * Never return passwordHash to the client (spec 7.3). `permissions` is
 * always derived fresh from `role` (frozen RBAC policy) rather than read
 * from the stored column, so a response can never reflect stale data.
 */
function serializeStaff(staff: Staff) {
  return {
    id: staff.id,
    organizationId: staff.organizationId,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    permissions: getEffectivePermissions(staff.role),
    status: staff.status,
    /** ADR-069: the Admin workspace an Executive belongs to (null: none). */
    workspaceAdminId: staff.workspaceAdminId,
    /// ADR-035: true while this person still has an unaccepted invitation,
    /// which is what the dashboard's Resend action keys off. Never exposes
    /// the token itself.
    invitationPending: staff.status === 'PENDING_EMAIL_VERIFICATION' && staff.invitationSentAt !== null,
    invitationSentAt: staff.invitationSentAt,
    lastLoginAt: staff.lastLoginAt,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
  };
}

async function findStaffScoped(actor: WorkspaceActor, staffId: string): Promise<Staff> {
  // ADR-069: someone outside the actor's workspace scope is "not found".
  const staff = await prisma.staff.findFirst({ where: { AND: [{ id: staffId }, visibleStaffWhere(actor)] } });
  if (!staff) {
    throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff member not found.');
  }
  return staff;
}

/**
 * Server-side search over the whole organization's staff, not just the
 * currently-loaded page — the list is paginated, so filtering client-side
 * would silently hide matches sitting on other pages.
 *
 * `organizationId` stays a top-level (AND-ed) condition with the search
 * `OR` nested strictly inside it, so no search term can ever widen the
 * tenant scope (CLAUDE.md Rule 4).
 *
 * `role` is a Postgres enum, so `contains` doesn't apply to it — the search
 * term is instead matched against the role *names* and turned into an
 * `in` filter, which is what makes "admin"/"staff" work case-insensitively
 * from the user's point of view.
 */
function buildStaffWhere(actor: WorkspaceActor, search?: string, adminId?: string): Prisma.StaffWhereInput {
  const scope = visibleStaffWhere(actor);
  // ADR-069: Head/Manager may narrow to one Admin's workspace — the Admin
  // and their Executives.
  const workspace: Prisma.StaffWhereInput =
    adminId && isOrganizationWide(actor) ? { OR: [{ id: adminId }, { workspaceAdminId: adminId }] } : {};
  if (!search) {
    return { AND: [scope, workspace] };
  }

  const term = search.toLowerCase();
  const matchingRoles = STAFF_ROLES.filter(
    (role) => role.toLowerCase().includes(term) || ROLE_LABELS[role].includes(term),
  );

  return {
    AND: [scope, workspace],
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      ...(matchingRoles.length > 0 ? [{ role: { in: matchingRoles } }] : []),
    ],
  };
}

export async function listStaff(
  actor: WorkspaceActor,
  page: number,
  pageSize: number,
  search?: string,
  adminId?: string,
) {
  const where = buildStaffWhere(actor, search, adminId);
  const [staff, total] = await Promise.all([
    prisma.staff.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.staff.count({ where }),
  ]);

  return {
    data: staff.map(serializeStaff),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function getStaff(actor: WorkspaceActor, staffId: string) {
  const staff = await findStaffScoped(actor, staffId);
  return serializeStaff(staff);
}

/**
 * ADR-035: creating a staff member now invites them rather than handing an
 * admin a password to pass along. The account exists immediately but cannot
 * be signed into until the invitee follows the emailed link and chooses their
 * own password, so no credential is ever known by two people.
 *
 * The email is sent after the row is committed and never rolls it back: a
 * provider outage must not lose an account an admin just created. The result
 * says whether delivery worked so the dashboard can offer Resend instead of
 * pretending it arrived.
 */
/**
 * ADR-069 D4: who may invite whom, and into which workspace.
 *  - Admins and Organization Managers: only the Organization Head.
 *  - Executives: the Head (into a chosen Admin's workspace, or
 *    organization-level) or an Admin (always into their own workspace).
 *  - Managers invite nobody (no manage_staff).
 */
async function resolveInviteWorkspace(actor: WorkspaceActor, input: CreateStaffInput): Promise<string | null> {
  if (input.role !== 'STAFF') {
    if (actor.role !== 'OWNER') {
      throw new AppError(
        403,
        'HIGHER_ROLE_REQUIRES_HEAD',
        'Only the Organization Head can invite Admins or Organization Managers.',
      );
    }
    return null;
  }
  if (actor.role === 'ADMIN') {
    if (input.workspaceAdminId && input.workspaceAdminId !== actor.staffId) {
      throw new AppError(403, 'FORBIDDEN', 'You can only invite Executives into your own workspace.');
    }
    return actor.staffId;
  }
  if (actor.role === 'OWNER') {
    if (!input.workspaceAdminId) return null;
    await requireWorkspaceAdmin(actor.organizationId, input.workspaceAdminId);
    return input.workspaceAdminId;
  }
  throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
}

async function requireWorkspaceAdmin(organizationId: string, adminId: string, client: Prisma.TransactionClient = prisma) {
  const admin = await client.staff.findFirst({
    where: { id: adminId, organizationId, role: 'ADMIN', status: { not: 'SUSPENDED' } },
    select: { id: true },
  });
  if (!admin) throw new AppError(404, 'ADMIN_NOT_FOUND', 'That Admin could not be found.');
}

export async function createStaff(actor: WorkspaceActor, input: CreateStaffInput) {
  const organizationId = actor.organizationId;
  const workspaceAdminId = await resolveInviteWorkspace(actor, input);
  const existing = await prisma.staff.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'This email is already registered.');
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true },
  });
  const token = generateInvitationToken();

  const staff = await prisma.staff.create({
    data: {
      organizationId,
      name: input.name,
      email: input.email,
      passwordHash: await unusablePasswordHash(),
      role: input.role,
      workspaceAdminId,
      // Role-derived, not client-suppliable (frozen RBAC policy) — kept in
      // sync on the stored row purely for observability; no code path reads
      // this column back as authoritative (see getEffectivePermissions).
      permissions: getEffectivePermissions(input.role),
      // Blocks sign-in until the invitation is accepted, reusing the status
      // every gate already understands.
      status: 'PENDING_EMAIL_VERIFICATION',
      invitationTokenHash: token.hash,
      invitationExpiresAt: token.expiresAt,
      invitationSentAt: new Date(),
    },
  });

  const emailSent = await dispatchInvitation({
    id: staff.id,
    email: staff.email,
    name: staff.name,
    role: staff.role,
    organizationName: organization.name,
    rawToken: token.raw,
  });

  return { ...serializeStaff(staff), invitationEmailSent: emailSent };
}

/**
 * ADR-061: suspension follows the same governance as removal (ADR-057).
 *
 * - OWNER: may change any ADMIN or STAFF account, suspension included.
 * - ADMIN: may change STAFF accounts, suspension included. On another ADMIN
 *   they may change nothing — suspending, demoting, re-addressing or setting
 *   the password of a fellow admin would each end or take over that admin's
 *   access, which only the owner decides (they ask through a removal
 *   request). On their own account only the display name; never their own
 *   status, role, email or password through this endpoint.
 * - STAFF: never reaches here (manage_staff).
 *
 * A field counts only when it would actually change, so a client sending a
 * whole form back with the stored values is not refused.
 */
function assertMayUpdate(
  actor: { staffId: string; role: StaffRole },
  existing: Staff,
  input: UpdateStaffInput,
): void {
  if (actor.role === 'OWNER') return;
  // ADR-069 D4: roles are changed by the Organization Head only — an Admin
  // can no longer promote an Executive or demote anyone.
  if (input.role !== undefined && input.role !== existing.role) {
    throw new AppError(403, 'HIGHER_ROLE_REQUIRES_HEAD', 'Only the Organization Head can change roles.');
  }
  const isSelf = actor.staffId === existing.id;
  if (!isSelf && existing.role === 'STAFF') return;
  if (!isSelf && existing.role !== 'ADMIN') {
    throw new AppError(403, 'ADMIN_CHANGE_REQUIRES_OWNER', "Only the Organization Head can change this person's account.");
  }

  const changes = {
    status: input.status !== undefined && input.status !== existing.status,
    role: input.role !== undefined && input.role !== existing.role,
    email: input.email !== undefined && input.email !== existing.email,
    password: input.password !== undefined,
    name: input.name !== undefined && input.name !== existing.name,
  };

  if (isSelf) {
    if (changes.status) {
      throw new AppError(403, 'CANNOT_SUSPEND_SELF', 'You cannot change your own account status.');
    }
    if (changes.role || changes.email || changes.password) {
      throw new AppError(
        403,
        'CANNOT_CHANGE_OWN_ACCESS',
        'You cannot change your own role, email or password here. Use your Profile for your password.',
      );
    }
    return;
  }

  // Another ADMIN.
  if (changes.status) {
    throw new AppError(
      403,
      'SUSPENSION_REQUIRES_OWNER_APPROVAL',
      'Only the owner can suspend or reactivate an admin. Send a request to the owner instead.',
    );
  }
  if (changes.role || changes.email || changes.password || changes.name) {
    throw new AppError(
      403,
      'ADMIN_CHANGE_REQUIRES_OWNER',
      "Only the owner can change another admin's account.",
    );
  }
}

export async function updateStaff(
  scopeActor: WorkspaceActor,
  staffId: string,
  input: UpdateStaffInput,
  actor: { staffId: string; role: StaffRole },
) {
  const existing = await findStaffScoped(scopeActor, staffId);
  assertNotOwner(existing);
  assertMayUpdate(actor, existing, input);

  if (input.email && input.email !== existing.email) {
    const emailOwner = await prisma.staff.findUnique({ where: { email: input.email } });
    if (emailOwner) {
      throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'This email is already registered.');
    }
  }

  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  // Self-healing on every touch: whether or not this update changes `role`,
  // the stored `permissions` column is recomputed from the *effective* role
  // so no stale value can ever linger past an edit (frozen RBAC policy —
  // "no stale permissions may survive a role change").
  const effectiveRole = input.role ?? existing.role;

  /**
   * ADR-035 escape hatch: an administrator setting a password on someone who
   * was invited but has not accepted activates them, and cancels the pending
   * invitation.
   *
   * Without this, a broken mailbox would strand a colleague permanently —
   * invited, unable to sign in, and with no route to access but resending an
   * email that never arrives. It is a deliberate, explicit admin action, not
   * the default path, and it reverts to the pre-invitation trade-off (the
   * admin knows the password) only for the person they choose.
   *
   * Scoped to *invited* accounts by requiring invitationSentAt: a pending
   * OWNER is mid-email-verification (ADR-024) and must never be activated by
   * a password write, which would skip proving they own the address.
   */
  const activatesInvitee =
    Boolean(passwordHash) &&
    existing.status === 'PENDING_EMAIL_VERIFICATION' &&
    existing.invitationSentAt !== null;

  const staff = await prisma.$transaction(async (tx) => {
    // ADR-064: someone called or being served at this person's counter can
    // only be finished by them, so they stay active until that visit is
    // resolved. A role change does not touch their counter: every role may
    // hold one and serve from it.
    const leavesServing =
      input.status !== undefined && input.status !== 'ACTIVE' && existing.status === 'ACTIVE';
    if (leavesServing) {
      await assertNoActiveServiceForStaff(tx, staffId);
    }
    const roleChanges = input.role !== undefined && input.role !== existing.role;
    const updated = await tx.staff.update({
      where: { id: staffId },
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        permissions: getEffectivePermissions(effectiveRole),
        status: input.status ?? (activatesInvitee ? 'ACTIVE' : undefined),
        ...(passwordHash ? { passwordHash } : {}),
        ...(activatesInvitee ? { invitationTokenHash: null, invitationExpiresAt: null } : {}),
        // ADR-069: an Executive's workspace belongs to the Executive role;
        // any role change leaves it.
        ...(roleChanges ? { workspaceAdminId: null } : {}),
      },
    });
    if (roleChanges && existing.role === 'ADMIN') {
      // ADR-069: an Admin's queue and Executives return to the Head (the
      // same transitional state as before workspaces) rather than vanish.
      await tx.queue.updateMany({ where: { adminId: staffId, deletedAt: null }, data: { adminId: null } });
      await tx.staff.updateMany({ where: { workspaceAdminId: staffId }, data: { workspaceAdminId: null } });
    }
    // Suspended, or no longer allowed to operate the queue of the counter
    // they hold: that counter is turned off and they are released.
    if (leavesServing) {
      await releaseOperatorCounter(tx, staffId);
    } else if (roleChanges) {
      await releaseOperatorCounter(tx, staffId, { keepIfEligible: true });
    }
    return updated;
  });

  return serializeStaff(staff);
}

/** ADR-035 — thin pass-through so the controller keeps talking to one
 * service, while the invitation mechanics live with the rest of their kind. */
/**
 * ADR-069 D3: the Organization Head moves an Executive into an Admin's
 * workspace (or back to organization-level with null). If they hold a counter
 * outside that workspace, it is turned off and they are released (refused
 * while they are serving someone).
 */
export async function setExecutiveWorkspace(actor: WorkspaceActor, staffId: string, adminId: string | null) {
  if (actor.role !== 'OWNER') {
    throw new AppError(403, 'FORBIDDEN', 'Only the Organization Head can move Executives between workspaces.');
  }
  const target = await findStaffScoped(actor, staffId);
  if (target.role !== 'STAFF') {
    throw new AppError(422, 'NOT_AN_EXECUTIVE', 'Only Executives belong to an Admin workspace.');
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (adminId) await requireWorkspaceAdmin(actor.organizationId, adminId, tx);
    const row = await tx.staff.update({ where: { id: staffId }, data: { workspaceAdminId: adminId } });
    await releaseOperatorCounter(tx, staffId, { keepIfEligible: true });
    return row;
  });
  return serializeStaff(updated);
}

export function resendStaffInvitation(organizationId: string, staffId: string) {
  return resendInvitation(organizationId, staffId);
}

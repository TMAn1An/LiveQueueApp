import type { Prisma, Staff, StaffRole } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
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
const STAFF_ROLES: StaffRole[] = ['OWNER', 'ADMIN', 'STAFF'];

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

async function findStaffScoped(organizationId: string, staffId: string): Promise<Staff> {
  const staff = await prisma.staff.findFirst({ where: { id: staffId, organizationId } });
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
function buildStaffWhere(organizationId: string, search?: string): Prisma.StaffWhereInput {
  if (!search) {
    return { organizationId };
  }

  const matchingRoles = STAFF_ROLES.filter((role) => role.includes(search.toUpperCase()));

  return {
    organizationId,
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      ...(matchingRoles.length > 0 ? [{ role: { in: matchingRoles } }] : []),
    ],
  };
}

export async function listStaff(
  organizationId: string,
  page: number,
  pageSize: number,
  search?: string,
) {
  const where = buildStaffWhere(organizationId, search);
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

export async function getStaff(organizationId: string, staffId: string) {
  const staff = await findStaffScoped(organizationId, staffId);
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
export async function createStaff(organizationId: string, input: CreateStaffInput) {
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

export async function updateStaff(organizationId: string, staffId: string, input: UpdateStaffInput) {
  const existing = await findStaffScoped(organizationId, staffId);
  assertNotOwner(existing);

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

  const staff = await prisma.staff.update({
    where: { id: staffId },
    data: {
      name: input.name,
      email: input.email,
      role: input.role,
      permissions: getEffectivePermissions(effectiveRole),
      status: input.status ?? (activatesInvitee ? 'ACTIVE' : undefined),
      ...(passwordHash ? { passwordHash } : {}),
      ...(activatesInvitee ? { invitationTokenHash: null, invitationExpiresAt: null } : {}),
    },
  });

  return serializeStaff(staff);
}

/** Spec 7.3: "Owner cannot be deleted by normal staff." */
export async function deleteStaff(organizationId: string, staffId: string) {
  const existing = await findStaffScoped(organizationId, staffId);
  if (existing.role === 'OWNER') {
    throw new AppError(403, 'CANNOT_DELETE_OWNER', 'The organization owner cannot be deleted.');
  }
  await prisma.staff.delete({ where: { id: staffId } });
}

/** ADR-035 — thin pass-through so the controller keeps talking to one
 * service, while the invitation mechanics live with the rest of their kind. */
export function resendStaffInvitation(organizationId: string, staffId: string) {
  return resendInvitation(organizationId, staffId);
}

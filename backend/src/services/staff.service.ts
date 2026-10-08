import { Prisma as PrismaNs, type Prisma, type Staff, type StaffRole } from '@prisma/client';
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
import { actorFromAuth, loadActorSnapshot, personSnapshot, recordGovernanceEvent } from './audit.service';
import { assertAdminMayLeaveWorkspace, lockOrganization, lockStaffRows, revokeAllAccess } from './governance.service';
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
    throw new AppError(404, 'STAFF_NOT_FOUND', 'Associate not found.');
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

/** The signed-in person performing a governance change (req.auth). */
export type GovernanceActor = WorkspaceActor & { email: string };

/**
 * ADR-035: creating a staff member invites them rather than handing an
 * admin a password to pass along. The account exists immediately but cannot
 * be signed into until the invitee follows the emailed link and chooses their
 * own password, so no credential is ever known by two people.
 *
 * ADR-071: the account and its `staff_created` audit row are written in one
 * transaction. The email is sent after commit and never rolls the account
 * back: a provider outage must not lose an account an admin just created.
 */
/**
 * ADR-069 D4 / ADR-071 D13: who may invite whom, and into which workspace.
 *  - Admins and Organization Managers: only the Organization Head.
 *  - Executives: the Head, into a chosen Admin's workspace (required — no
 *    new organization-level Executives), or an Admin, always into their own.
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
    if (input.workspaceAdminId) {
      throw new AppError(422, 'WORKSPACE_ONLY_FOR_EXECUTIVES', 'Only Executives belong to an Admin workspace.');
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
    if (!input.workspaceAdminId) throw executiveWorkspaceRequired();
    await requireWorkspaceAdmin(actor.organizationId, input.workspaceAdminId);
    return input.workspaceAdminId;
  }
  throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
}

function executiveWorkspaceRequired(): AppError {
  return new AppError(
    422,
    'EXECUTIVE_WORKSPACE_REQUIRED',
    'Choose the Admin whose workspace this Executive belongs to.',
  );
}

async function requireWorkspaceAdmin(organizationId: string, adminId: string, client: Prisma.TransactionClient = prisma) {
  const admin = await client.staff.findFirst({
    where: { id: adminId, organizationId, role: 'ADMIN', status: { not: 'SUSPENDED' } },
    select: { id: true },
  });
  if (!admin) throw new AppError(404, 'ADMIN_NOT_FOUND', 'That Admin could not be found.');
}

function emailTaken(): AppError {
  return new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'This email is already registered.');
}

export async function createStaff(actor: GovernanceActor, input: CreateStaffInput, ipAddress?: string) {
  const organizationId = actor.organizationId;
  const workspaceAdminId = await resolveInviteWorkspace(actor, input);
  const existing = await prisma.staff.findUnique({ where: { email: input.email } });
  if (existing) throw emailTaken();

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true },
  });
  const token = generateInvitationToken();
  const passwordHash = await unusablePasswordHash();

  let staff: Staff;
  try {
    staff = await prisma.$transaction(async (tx) => {
      const row = await tx.staff.create({
        data: {
          organizationId,
          name: input.name,
          email: input.email,
          passwordHash,
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
      await recordGovernanceEvent(tx, {
        actor: actorFromAuth(actor),
        actorSnapshot: await loadActorSnapshot(tx, actor.staffId),
        action: 'staff_created',
        entityType: 'staff',
        entityId: row.id,
        metadata: { target: personSnapshot(row), invited: true },
        workspaceAdminId: row.role === 'STAFF' ? row.workspaceAdminId : null,
        ipAddress,
      });
      return row;
    });
  } catch (err) {
    // Two invitations racing for one address: the unique index decides.
    if (err instanceof PrismaNs.PrismaClientKnownRequestError && err.code === 'P2002') throw emailTaken();
    throw err;
  }

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
 * - OWNER: may change any ADMIN, MANAGER or STAFF account, suspension included.
 * - ADMIN: may change STAFF accounts of their workspace, suspension included.
 *   On another ADMIN they may change nothing. On their own account only the
 *   display name.
 * - Roles are changed by the Organization Head only (ADR-069 D4).
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
      'Only the Organization Head can suspend or reactivate an admin. Send a request to the Organization Head instead.',
    );
  }
  if (changes.role || changes.email || changes.password || changes.name) {
    throw new AppError(
      403,
      'ADMIN_CHANGE_REQUIRES_OWNER',
      "Only the Organization Head can change another admin's account.",
    );
  }
}

/**
 * The target of a governance action (edit, suspend). Executives outside the
 * actor's workspace are "not found" (ADR-069); the organization's Head,
 * Managers and other Admins stay addressable so the long-standing refusals
 * (CANNOT_MODIFY_OWNER, SUSPENSION_REQUIRES_OWNER_APPROVAL, …) still explain
 * why the action is not allowed, instead of pretending they do not exist.
 */
async function findGovernanceTarget(actor: WorkspaceActor, staffId: string): Promise<Staff> {
  if (actor.role === 'ADMIN') {
    const higher = await prisma.staff.findFirst({
      where: { id: staffId, organizationId: actor.organizationId, role: { not: 'STAFF' } },
    });
    if (higher) return higher;
  }
  return findStaffScoped(actor, staffId);
}

/** The workspace an audit row about this person belongs to: an Executive's
 * Admin; otherwise the acting person's default (see audit.service). */
function auditWorkspaceFor(before: Staff, after: Staff): string | null | undefined {
  if (after.role === 'STAFF') return after.workspaceAdminId;
  if (before.role === 'STAFF') return before.workspaceAdminId;
  return undefined;
}

/**
 * ADR-071 role transition matrix (roles: Head only; ADR-069 D4):
 *  - Executive → Manager: counter released (Managers never serve); refused
 *    while they are serving someone.
 *  - Executive → Admin / Manager → Admin: no queue yet; leaves any workspace.
 *  - Manager → Executive / Admin → Executive: destination Admin workspace
 *    is required.
 *  - Admin who owns a live queue, or still has Executives: refused with
 *    ADMIN_OWNS_LIVE_QUEUE / ADMIN_HAS_EXECUTIVES — the workspace is handed
 *    to a replacement through the transfer workflow (adminTransfer.service).
 *  - The Organization Head is never changed here (succession only).
 * Suspension (ADR-071 D9) is temporary: an Admin keeps their queue, but
 * every session ends at once and their counter is released.
 *
 * The change and its audit row (with before/after role, status and
 * workspace) commit together. `authorizationChanged` tells the caller to
 * close the person's open sockets so their rooms are rebuilt.
 */
export async function updateStaff(
  actor: GovernanceActor,
  staffId: string,
  input: UpdateStaffInput,
  ipAddress?: string,
): Promise<{ staff: ReturnType<typeof serializeStaff>; authorizationChanged: boolean }> {
  const existing = await findGovernanceTarget(actor, staffId);
  assertNotOwner(existing);
  assertMayUpdate(actor, existing, input);

  const roleChanges = input.role !== undefined && input.role !== existing.role;
  if (input.workspaceAdminId !== undefined && !(roleChanges && input.role === 'STAFF')) {
    throw new AppError(
      422,
      'WORKSPACE_ONLY_WITH_EXECUTIVE_ROLE',
      'A workspace is chosen here only when making someone an Executive. Use Move to workspace instead.',
    );
  }
  if (roleChanges && input.role === 'STAFF' && !input.workspaceAdminId) {
    throw executiveWorkspaceRequired();
  }

  if (input.email && input.email !== existing.email) {
    const emailOwner = await prisma.staff.findUnique({ where: { email: input.email } });
    if (emailOwner) throw emailTaken();
  }

  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  // Self-healing on every touch: whether or not this update changes `role`,
  // the stored `permissions` column is recomputed from the *effective* role
  // so no stale value can ever linger past an edit (frozen RBAC policy).
  const effectiveRole = input.role ?? existing.role;

  /**
   * ADR-035 escape hatch: an administrator setting a password on someone who
   * was invited but has not accepted activates them, and cancels the pending
   * invitation. Scoped to *invited* accounts by requiring invitationSentAt: a
   * pending OWNER is mid-email-verification (ADR-024) and must never be
   * activated by a password write.
   */
  const activatesInvitee =
    Boolean(passwordHash) &&
    existing.status === 'PENDING_EMAIL_VERIFICATION' &&
    existing.invitationSentAt !== null;

  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, actor.organizationId);
      await lockStaffRows(tx, actor.organizationId, [staffId]);
      // Re-read under the lock: the guards below decide on current state.
      const current = await tx.staff.findUnique({ where: { id: staffId } });
      if (!current || current.organizationId !== actor.organizationId) {
        throw new AppError(404, 'STAFF_NOT_FOUND', 'Associate not found.');
      }
      assertNotOwner(current);

      if (roleChanges) {
        await assertAdminMayLeaveWorkspace(tx, current);
        if (input.role === 'STAFF') {
          if (input.workspaceAdminId === staffId) throw executiveWorkspaceRequired();
          await requireWorkspaceAdmin(actor.organizationId, input.workspaceAdminId!, tx);
        }
      }

      const statusChanges = input.status !== undefined && input.status !== current.status;
      // ADR-064: someone called or being served at this person's counter can
      // only be finished by them, so they stay active until that visit ends.
      const leavesServing = statusChanges && input.status !== 'ACTIVE' && current.status === 'ACTIVE';
      if (leavesServing) {
        await assertNoActiveServiceForStaff(tx, staffId);
      }
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
          // An Executive's workspace belongs to the Executive role: a new
          // Executive joins the chosen Admin; any other role leaves it.
          ...(roleChanges ? { workspaceAdminId: input.role === 'STAFF' ? input.workspaceAdminId! : null } : {}),
        },
      });
      if (leavesServing) {
        await releaseOperatorCounter(tx, staffId);
      } else if (roleChanges) {
        // Refused (with the active-service code) while they are serving.
        await releaseOperatorCounter(tx, staffId, { keepIfEligible: true });
      }
      // Suspension, or someone else setting this person's password, ends
      // every session they have at once.
      const revokesAccess = leavesServing || (Boolean(passwordHash) && current.status === 'ACTIVE');
      if (revokesAccess) {
        await revokeAllAccess(tx, staffId);
      }

      const changedFields = Object.keys(input).filter((key) => {
        if (key === 'password') return input.password !== undefined;
        const k = key as keyof typeof current;
        return input[key as keyof UpdateStaffInput] !== undefined && input[key as keyof UpdateStaffInput] !== current[k];
      });
      await recordGovernanceEvent(tx, {
        actor: actorFromAuth(actor),
        actorSnapshot: await loadActorSnapshot(tx, actor.staffId),
        action: 'staff_updated',
        entityType: 'staff',
        entityId: staffId,
        // Values, not just field names, for role/status/workspace — never
        // the password itself (only that it was set).
        metadata: {
          changedFields,
          before: personSnapshot(current),
          after: personSnapshot(updated),
          ...(passwordHash ? { signInReset: true } : {}),
          ...(revokesAccess ? { sessionsEnded: true } : {}),
        },
        workspaceAdminId: auditWorkspaceFor(current, updated),
        ipAddress,
      });

      return {
        staff: serializeStaff(updated),
        authorizationChanged: roleChanges || statusChanges || revokesAccess,
      };
    });
  } catch (err) {
    if (err instanceof PrismaNs.PrismaClientKnownRequestError && err.code === 'P2002') throw emailTaken();
    throw err;
  }
}

/**
 * ADR-069 D3: the Organization Head moves an Executive into an Admin's
 * workspace. ADR-071 D13: always into a workspace — never back to
 * organization level. If they hold a counter outside that workspace, it is
 * turned off and they are released (refused while they are serving someone).
 */
export async function setExecutiveWorkspace(
  actor: GovernanceActor,
  staffId: string,
  adminId: string | null,
  ipAddress?: string,
) {
  if (actor.role !== 'OWNER') {
    throw new AppError(403, 'FORBIDDEN', 'Only the Organization Head can move Executives between workspaces.');
  }
  if (!adminId) throw executiveWorkspaceRequired();
  const target = await findStaffScoped(actor, staffId);
  if (target.role !== 'STAFF') {
    throw new AppError(422, 'NOT_AN_EXECUTIVE', 'Only Executives belong to an Admin workspace.');
  }
  const updated = await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, actor.organizationId);
    await requireWorkspaceAdmin(actor.organizationId, adminId, tx);
    const row = await tx.staff.update({ where: { id: staffId }, data: { workspaceAdminId: adminId } });
    await releaseOperatorCounter(tx, staffId, { keepIfEligible: true });
    await recordGovernanceEvent(tx, {
      actor: actorFromAuth(actor),
      actorSnapshot: await loadActorSnapshot(tx, actor.staffId),
      action: 'staff_updated',
      entityType: 'staff',
      entityId: staffId,
      metadata: {
        changedFields: ['workspaceAdminId'],
        before: personSnapshot(target),
        after: personSnapshot(row),
      },
      workspaceAdminId: adminId,
      ipAddress,
    });
    return row;
  });
  return serializeStaff(updated);
}

export function resendStaffInvitation(organizationId: string, staffId: string) {
  return resendInvitation(organizationId, staffId);
}

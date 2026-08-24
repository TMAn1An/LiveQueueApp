import type { Staff } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { hashPassword } from '../utils/password';
import { getEffectivePermissions } from '../constants/permissions';
import type { createStaffSchema, updateStaffSchema } from '../validators/staff.validators';

type CreateStaffInput = z.infer<typeof createStaffSchema.body>;
type UpdateStaffInput = z.infer<typeof updateStaffSchema.body>;

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

export async function listStaff(organizationId: string, page: number, pageSize: number) {
  const [staff, total] = await Promise.all([
    prisma.staff.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.staff.count({ where: { organizationId } }),
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

export async function createStaff(organizationId: string, input: CreateStaffInput) {
  const existing = await prisma.staff.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'This email is already registered.');
  }

  const passwordHash = await hashPassword(input.password);
  const staff = await prisma.staff.create({
    data: {
      organizationId,
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
      // Role-derived, not client-suppliable (frozen RBAC policy) — kept in
      // sync on the stored row purely for observability; no code path reads
      // this column back as authoritative (see getEffectivePermissions).
      permissions: getEffectivePermissions(input.role),
    },
  });

  return serializeStaff(staff);
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

  const staff = await prisma.staff.update({
    where: { id: staffId },
    data: {
      name: input.name,
      email: input.email,
      role: input.role,
      permissions: getEffectivePermissions(effectiveRole),
      status: input.status,
      ...(passwordHash ? { passwordHash } : {}),
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

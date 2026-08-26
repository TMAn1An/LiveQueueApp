import type { Organization, Staff } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { hashPassword, verifyPassword } from '../utils/password';
import { signAccessToken } from '../utils/tokens';
import {
  createSession,
  revokeOtherSessions,
  revokeSession,
  rotateSession,
  type SessionMeta,
} from './session.service';
import { getEffectivePermissions } from '../constants/permissions';

interface RegisterInput {
  organizationName: string;
  email: string;
  password: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  refreshToken: string;
}

function toSafeStaff(staff: Staff) {
  return {
    id: staff.id,
    organizationId: staff.organizationId,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    status: staff.status,
    lastLoginAt: staff.lastLoginAt,
    createdAt: staff.createdAt,
  };
}

function toSafeOrganization(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    status: organization.status,
  };
}

async function issueTokens(staff: Staff, meta: SessionMeta) {
  const accessToken = signAccessToken({
    sub: staff.id,
    organizationId: staff.organizationId,
    role: staff.role,
  });
  const { rawRefreshToken } = await createSession(staff.id, meta);
  return { accessToken, refreshToken: rawRefreshToken };
}

export async function register(input: RegisterInput, meta: SessionMeta) {
  const existing = await prisma.staff.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'This email is already registered.');
  }

  const passwordHash = await hashPassword(input.password);
  // Registration only collects an organization name, email, and password (spec 4.1);
  // the owner's display name defaults to the email's local part and can be
  // changed later once staff-profile management ships.
  const ownerName = input.email.split('@')[0] as string;

  const { staff, organization } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: input.organizationName },
    });

    const staff = await tx.staff.create({
      data: {
        organizationId: organization.id,
        name: ownerName,
        email: input.email,
        passwordHash,
        role: 'OWNER',
        permissions: getEffectivePermissions('OWNER'),
      },
    });

    return { staff, organization };
  });

  const tokens = await issueTokens(staff, meta);

  return {
    staff: toSafeStaff(staff),
    organization: toSafeOrganization(organization),
    permissions: getEffectivePermissions(staff.role),
    ...tokens,
  };
}

export async function login(input: LoginInput, meta: SessionMeta) {
  const staff = await prisma.staff.findUnique({
    where: { email: input.email },
    include: { organization: true },
  });

  if (!staff) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const passwordValid = await verifyPassword(input.password, staff.passwordHash);
  if (!passwordValid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (staff.status !== 'ACTIVE') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended.');
  }

  if (staff.organization.status !== 'ACTIVE') {
    throw new AppError(403, 'ORGANIZATION_SUSPENDED', 'This organization is not active.');
  }

  const updatedStaff = await prisma.staff.update({
    where: { id: staff.id },
    data: { lastLoginAt: new Date() },
  });

  const tokens = await issueTokens(updatedStaff, meta);

  return {
    staff: toSafeStaff(updatedStaff),
    organization: toSafeOrganization(staff.organization),
    permissions: getEffectivePermissions(updatedStaff.role),
    ...tokens,
  };
}

export async function getCurrentUser(staffId: string) {
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    include: { organization: true },
  });

  if (!staff) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Account no longer exists.');
  }

  return {
    staff: toSafeStaff(staff),
    organization: toSafeOrganization(staff.organization),
    permissions: getEffectivePermissions(staff.role),
  };
}

export async function refresh(rawRefreshToken: string, meta: SessionMeta) {
  const rotated = await rotateSession(rawRefreshToken, meta);

  const staff = await prisma.staff.findUnique({ where: { id: rotated.staffId } });
  if (!staff || staff.status !== 'ACTIVE') {
    throw new AppError(401, 'UNAUTHENTICATED', 'Account is not active.');
  }

  const accessToken = signAccessToken({
    sub: staff.id,
    organizationId: staff.organizationId,
    role: staff.role,
  });

  return { accessToken, refreshToken: rotated.rawRefreshToken };
}

export async function logout(rawRefreshToken: string, staffId: string) {
  await revokeSession(rawRefreshToken, staffId);
}

/**
 * Self-service password change (V2 Checkpoint 1, ADR-022). `staffId` comes
 * from `req.auth` (the authenticate middleware's fresh DB read) — the caller
 * can never target another staff member's account through this function.
 */
export async function changePassword(staffId: string, input: ChangePasswordInput) {
  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staff) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Account no longer exists.');
  }

  const currentValid = await verifyPassword(input.currentPassword, staff.passwordHash);
  if (!currentValid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.staff.update({ where: { id: staffId }, data: { passwordHash } });
  await revokeOtherSessions(staffId, input.refreshToken);
}

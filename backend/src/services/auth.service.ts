import type { Organization, Staff } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { isValidTimezone } from '../utils/customerIdentity';
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
import {
  claimOrganizationName,
  isOrganizationNameConflict,
  organizationNameTakenError,
} from './organization.service';
import {
  dispatchVerificationEmail,
  generateVerificationToken,
  newRegistrationDeadline,
} from './emailVerification.service';

interface RegisterInput {
  organizationName: string;
  email: string;
  password: string;
  /** ADR-035 — the browser's IANA zone, which becomes the organization's
   * starting timezone. Optional: an older dashboard does not send one, and
   * the organization simply has none until someone sets it in settings. */
  timezone?: string;
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
    // The dashboard reads both from the signed-in session: the zone every
    // queue inherits (ADR-035) — without it an inheriting queue showed "No
    // timezone set" — and whether the owner's first-run guide is finished.
    timezone: organization.timezone,
    onboardingCompletedAt: organization.onboardingCompletedAt,
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

/**
 * V2 Checkpoint 2 (ADR-024): the new owner starts PENDING_EMAIL_VERIFICATION,
 * not ACTIVE — closing the V1 gap where any email/password could
 * immediately operate a real organization with zero proof of ownership.
 * The verification token hash + both expiry timestamps are written inside
 * the same transaction as the org/staff rows (DB-only, no external call
 * while holding a lock); the actual email send happens after commit,
 * guarded, exactly like every other "notify after the DB transaction
 * succeeds" pattern in this codebase (CLAUDE.md §5) — a Resend outage must
 * never fail an otherwise-successful registration.
 */
/**
 * A self-registered owner who has not verified their email yet — as opposed
 * to an invited staff member, who is also PENDING_EMAIL_VERIFICATION but
 * carries no registration deadline and has no usable password until they
 * accept. Only the former has an open window to finish signing up.
 */
function isPendingSelfRegistration(staff: { status: string; registrationExpiresAt: Date | null }): boolean {
  return staff.status === 'PENDING_EMAIL_VERIFICATION' && staff.registrationExpiresAt != null;
}

function registrationWindowOpen(staff: { registrationExpiresAt: Date | null }): boolean {
  return staff.registrationExpiresAt != null && staff.registrationExpiresAt.getTime() > Date.now();
}

/**
 * Who may hold a dashboard session: an ACTIVE staff member, or an owner still
 * inside their registration window. The latter must be able to sign back in
 * — after closing the tab, reloading, or switching browser — to see the
 * verification banner and resend the email; the backend's requireVerified
 * middleware, not the session, is what keeps queue features closed to them.
 */
function mayHoldSession(staff: { status: string; registrationExpiresAt: Date | null }): boolean {
  return staff.status === 'ACTIVE' || (isPendingSelfRegistration(staff) && registrationWindowOpen(staff));
}

const REGISTRATION_EXPIRED_MESSAGE =
  'This registration expired before the email address was verified. Please register again.';

export async function register(input: RegisterInput, meta: SessionMeta) {
  const existing = await prisma.staff.findUnique({ where: { email: input.email } });
  if (existing) {
    // A lapsed, never-verified sign-up is exactly what the cleanup job
    // deletes; doing it here instead lets the person register again at once
    // rather than being told the address is taken by an account they can no
    // longer use. Only the owner's own pending organization is removed —
    // a live account, or one still inside its window, is never replaced.
    if (existing.role === 'OWNER' && isPendingSelfRegistration(existing) && !registrationWindowOpen(existing)) {
      await prisma.organization.deleteMany({
        where: {
          id: existing.organizationId,
          staff: { some: { id: existing.id, status: 'PENDING_EMAIL_VERIFICATION' } },
        },
      });
    } else {
      throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'This email is already registered.');
    }
  }

  // Organization names are unique like usernames (case-insensitive).
  const nameKey = await claimOrganizationName(input.organizationName);

  const passwordHash = await hashPassword(input.password);
  // Registration only collects an organization name, email, and password (spec 4.1);
  // the owner's display name defaults to the email's local part and can be
  // changed later once staff-profile management ships.
  const ownerName = input.email.split('@')[0] as string;
  const verificationToken = generateVerificationToken();

  const { staff, organization } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        nameKey,
        // Only kept when the runtime actually recognizes the zone; anything
        // else is dropped rather than left to break date arithmetic later.
        timezone: input.timezone && isValidTimezone(input.timezone) ? input.timezone : null,
      },
    });

    const staff = await tx.staff.create({
      data: {
        organizationId: organization.id,
        name: ownerName,
        email: input.email,
        passwordHash,
        role: 'OWNER',
        permissions: getEffectivePermissions('OWNER'),
        status: 'PENDING_EMAIL_VERIFICATION',
        emailVerificationTokenHash: verificationToken.hash,
        emailVerificationExpiresAt: verificationToken.expiresAt,
        registrationExpiresAt: newRegistrationDeadline(),
      },
    });

    return { staff, organization };
  }).catch((err: unknown) => {
    // Two people registering the same name at the same instant: the unique
    // index lets exactly one through; the other gets the friendly answer.
    if (isOrganizationNameConflict(err)) throw organizationNameTakenError();
    throw err;
  });

  const tokens = await issueTokens(staff, meta);

  // Registration still returns a usable session (spec: register -> enter
  // dashboard -> see verification-required state -> verify -> full access)
  // — the pending status alone is what gates queue functionality
  // (requireVerified), not the session itself.
  await dispatchVerificationEmail(staff.email, verificationToken.raw);

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

  if (!mayHoldSession(staff)) {
    if (isPendingSelfRegistration(staff)) {
      throw new AppError(403, 'REGISTRATION_EXPIRED', REGISTRATION_EXPIRED_MESSAGE);
    }
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
  if (!staff || !mayHoldSession(staff)) {
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

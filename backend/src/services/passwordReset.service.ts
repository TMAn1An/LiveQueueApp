import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import { hashPassword } from '../utils/password';
import { generateEmailLinkToken, hashRefreshToken } from '../utils/tokens';
import * as emailService from './email.service';

/**
 * ADR-058: "Forgot password?".
 *
 * Same token shape as email verification and staff invitations (ADR-060): a
 * 32-byte base64url value is emailed, and only its SHA-256 hash is stored.
 * The link works once, for PASSWORD_RESET_TTL_MINUTES, and redeeming it signs
 * the account out everywhere.
 *
 * Nothing here ever tells the caller whether an account exists. The request
 * endpoint answers identically for every address, and does the real work
 * after replying (see the controller), so neither the body nor the response
 * time reveals a registered email.
 */

/** A second email within this window is silently skipped. Measured from the
 * stored row, so it survives restarts and cannot be dodged with a new tab. */
const REQUEST_COOLDOWN_MS = 60 * 1000;

export const GENERIC_RESET_RESPONSE =
  'If an account exists for this email, a reset link has been sent.';

export function passwordResetUrl(rawToken: string): string {
  // APP_BASE_URL is server configuration, never request input, so the link
  // can only ever point at the configured dashboard (no open redirect).
  return `${env.APP_BASE_URL}/reset-password?token=${rawToken}`;
}

/**
 * Issues a reset link if — and only if — the address belongs to an account
 * that can sign in. Never throws and returns nothing: every outcome looks the
 * same from outside.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  try {
    const staff = await prisma.staff.findUnique({
      where: { email },
      include: { organization: { select: { status: true } } },
    });
    // Only an ACTIVE account in an ACTIVE organization can use a new
    // password. A pending invitee sets theirs through the invitation link; a
    // suspended account must not be revived through a side door.
    if (!staff || staff.status !== 'ACTIVE' || staff.organization.status !== 'ACTIVE') {
      return;
    }

    const latest = await prisma.passwordResetToken.findFirst({
      where: { staffId: staff.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < REQUEST_COOLDOWN_MS) {
      return;
    }

    // ADR-060: the same short, 256-bit, URL-safe token as every emailed link.
    const raw = generateEmailLinkToken();
    // One live link per account: a new request retires every older one.
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { staffId: staff.id, usedAt: null } }),
      prisma.passwordResetToken.create({
        data: {
          staffId: staff.id,
          tokenHash: hashRefreshToken(raw),
          expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000),
        },
      }),
    ]);

    const sent = await emailService.sendPasswordResetEmail({
      to: staff.email,
      name: staff.name,
      resetUrl: passwordResetUrl(raw),
      expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES,
    });
    if (!sent) {
      // No address, no token, no link in the log — only that it failed.
      logger.warn({ staffId: staff.id }, 'Password reset email was not delivered');
    }
  } catch (err) {
    logger.error({ message: (err as Error).message }, 'Password reset request failed');
  }
}

const INVALID_LINK = () =>
  new AppError(
    400,
    'INVALID_OR_EXPIRED_TOKEN',
    'This reset link is invalid, has expired or has already been used. Request a new one.',
  );

async function findUsableToken(rawToken: string) {
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    include: { staff: { select: { status: true } } },
  });
  if (!token || token.usedAt || token.expiresAt <= new Date() || token.staff.status !== 'ACTIVE') {
    return null;
  }
  return token;
}

/** Lets the reset page say "this link has expired" before anyone types a
 * new password. Read-only: checking a link never uses it up. */
export async function isResetTokenUsable(rawToken: string): Promise<boolean> {
  return (await findUsableToken(rawToken)) !== null;
}

/**
 * Redeems a link. One generic failure covers unknown, expired and already
 * used — the distinction helps nobody but someone guessing.
 */
export async function resetPassword(
  rawToken: string,
  newPassword: string,
): Promise<{ id: string; email: string; organizationId: string }> {
  const token = await findUsableToken(rawToken);
  if (!token) {
    throw INVALID_LINK();
  }
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // The conditional claim is what makes the link single-use under
    // concurrency: two simultaneous submissions both pass the read above,
    // but only one UPDATE can match `usedAt IS NULL`.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count === 0) {
      throw INVALID_LINK();
    }

    const staff = await tx.staff.update({
      where: { id: token.staffId },
      data: { passwordHash, accessRevokedAt: now },
    });
    // Signed out everywhere: no refresh session survives, and
    // `authenticate` refuses access tokens issued before accessRevokedAt.
    await tx.session.updateMany({
      where: { staffId: staff.id, revokedAt: null },
      data: { revokedAt: now },
    });
    // Any other link sent to this account is now pointless.
    await tx.passwordResetToken.deleteMany({
      where: { staffId: staff.id, usedAt: null },
    });

    return { id: staff.id, email: staff.email, organizationId: staff.organizationId };
  });
}

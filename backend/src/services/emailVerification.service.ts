import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import { generateRefreshToken, hashRefreshToken } from '../utils/tokens';
import { env } from '../config/env';
import * as emailService from './email.service';

/**
 * V2 Checkpoint 2 (ADR-024). Two independent lifetimes, deliberately not
 * conflated: a verification *link* expires in 15 minutes, but the *pending
 * registration* itself survives for 1 hour regardless of how many links
 * were sent or expired within that window — resending never extends this
 * deadline. Named constants, not env-configurable: these are fixed product
 * rules (standing V2 rules #14/#15), not per-environment tuning knobs.
 */
const VERIFICATION_TOKEN_TTL_MS = 15 * 60 * 1000;
const PENDING_REGISTRATION_TTL_MS = 60 * 60 * 1000;

export interface PendingVerification {
  tokenHash: string;
  tokenExpiresAt: Date;
  registrationExpiresAt: Date;
}

/**
 * Pure/synchronous — reuses generateRefreshToken()/hashRefreshToken()
 * (utils/tokens.ts) exactly as-is for the raw-opaque-token / SHA-256-hash
 * shape, the same pattern Session.refreshTokenHash already uses. No new
 * secret-handling mechanism. Returns the raw value alongside the hash so
 * the caller can email it once — only the hash is ever persisted.
 */
export function generateVerificationToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = generateRefreshToken();
  return {
    raw,
    hash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
  };
}

export function newRegistrationDeadline(): Date {
  return new Date(Date.now() + PENDING_REGISTRATION_TTL_MS);
}

/**
 * Fire-and-log, never throws — an email-provider failure must never turn an
 * already-successful registration/resend DB write into a failed HTTP
 * response (same "guarded" convention as realtime/emit.ts and
 * audit.service.ts's recordAuditEventSafely).
 */
export async function dispatchVerificationEmail(email: string, rawToken: string): Promise<void> {
  try {
    const verificationUrl = `${env.APP_BASE_URL}/verify-email?token=${rawToken}`;
    const sent = await emailService.sendVerificationEmail(email, verificationUrl);
    if (!sent) {
      logger.warn('Verification email was not sent (email delivery unavailable or failed)');
    }
  } catch (err) {
    logger.error({ err }, 'Unexpected error dispatching verification email');
  }
}

/**
 * Looks up by token hash directly (never by staffId/email in the URL) —
 * avoids any need to enumerate accounts and keeps the endpoint fully
 * anonymous/public, matching the customer-facing token-lookup trust model
 * already used elsewhere in this codebase (possession of the high-entropy
 * value is the only credential). A generic error covers "no such token",
 * "expired", and "already used" alike — never reveals which case applied.
 */
export async function verifyEmailToken(
  rawToken: string,
): Promise<{ id: string; organizationId: string; email: string }> {
  const hash = hashRefreshToken(rawToken);

  const staff = await prisma.staff.findFirst({
    where: { emailVerificationTokenHash: hash, status: 'PENDING_EMAIL_VERIFICATION' },
  });

  if (!staff || !staff.emailVerificationExpiresAt || staff.emailVerificationExpiresAt < new Date()) {
    throw new AppError(
      400,
      'INVALID_OR_EXPIRED_TOKEN',
      'This verification link is invalid or has expired. Please request a new one.',
    );
  }

  const updated = await prisma.staff.update({
    where: { id: staff.id },
    data: {
      status: 'ACTIVE',
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
      registrationExpiresAt: null,
    },
  });

  return { id: updated.id, organizationId: updated.organizationId, email: updated.email };
}

/**
 * Overwrites the single mutable token slot — this alone is what
 * "invalidates the previous token" (there is only ever one hash stored, so
 * writing a new one makes the old raw value unable to match anything,
 * without needing a separate revocation step). registrationExpiresAt is
 * deliberately left untouched: resending never extends the 1-hour deadline.
 */
export async function resendVerificationEmail(staffId: string): Promise<void> {
  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staff) {
    throw new AppError(404, 'STAFF_NOT_FOUND', 'Staff member not found.');
  }
  if (staff.status !== 'PENDING_EMAIL_VERIFICATION') {
    throw new AppError(409, 'ALREADY_VERIFIED', 'This account is already verified.');
  }

  const token = generateVerificationToken();
  await prisma.staff.update({
    where: { id: staffId },
    data: {
      emailVerificationTokenHash: token.hash,
      emailVerificationExpiresAt: token.expiresAt,
    },
  });

  await dispatchVerificationEmail(staff.email, token.raw);
}

/**
 * Single atomic DELETE (via a nested relation filter, not a separate
 * SELECT-then-DELETE) — Postgres evaluates the WHERE clause as part of the
 * statement itself, so a staff member who verifies in a separate,
 * concurrently-committing transaction is simply no longer matched by the
 * time this runs; there is no read-then-act race window to close. Deleting
 * the Organization cascades to its Staff row (onDelete: Cascade, see the
 * initial migration) — removing the pending owner together with the
 * organization, not just the email, so no half-created organization is
 * ever left behind. Idempotent: a second run against the same already-
 * deleted rows simply matches zero organizations.
 */
export async function cleanupExpiredPendingRegistrations(): Promise<{ deletedCount: number }> {
  const result = await prisma.organization.deleteMany({
    where: {
      staff: {
        some: {
          role: 'OWNER',
          status: 'PENDING_EMAIL_VERIFICATION',
          registrationExpiresAt: { lt: new Date() },
        },
      },
    },
  });

  return { deletedCount: result.count };
}

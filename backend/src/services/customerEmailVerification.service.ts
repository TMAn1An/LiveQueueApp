import { randomInt } from 'node:crypto';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import {
  computeIdentityFingerprint,
  emailCodeMatches,
  hashEmailCode,
  issueEmailVerificationProof,
  normalizeEmail,
} from '../utils/customerIdentity';
import { isEmailAvailable, sendCustomerVerificationCodeEmail } from './email.service';
import { describeJoinRequirements } from './queueIdentityPolicy.service';

/**
 * Proving a customer can read a mailbox, before they join a queue that
 * identifies people that way (ADR-037).
 *
 * Three verification flows now exist in this codebase and none of them is
 * interchangeable with the others:
 *  - the service-start OTP on Token proves to *staff* that the person at the
 *    counter is the right customer;
 *  - ADR-024's account verification proves an *owner* controls an address
 *    they registered with;
 *  - this proves to the *server* that whoever is joining can read a
 *    particular mailbox.
 * Different lifetimes, attempt budgets, secret purposes and storage.
 */

const CODE_LENGTH = 6;

/** Cryptographically secure, never Math.random — this gates an entitlement. */
function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/**
 * Uses the VERIFIED_EMAIL namespace so the proof's fingerprint is directly
 * comparable with the identity computed at join time — including in the
 * compound mode, which combines this exact value with the custom answer.
 */
export function emailFingerprintFor(queueId: string, normalizedEmail: string): string {
  return computeIdentityFingerprint({
    queueId,
    mode: 'VERIFIED_EMAIL',
    normalizedVerifiedContact: normalizedEmail,
  });
}

/**
 * Starts (or re-sends) a challenge. Resending reuses the row, so the cooldown
 * and attempt budget cannot be reset by simply asking again.
 */
export async function startCustomerEmailVerification(input: { queueId: string; email: string }) {
  const queue = await prisma.queue.findUnique({ where: { id: input.queueId } });
  if (!queue || queue.deletedAt) {
    throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
  }

  // Only queues that actually identify customers by email may send mail.
  const requirements = describeJoinRequirements(queue);
  if (!requirements.requiresVerifiedEmail) {
    throw new AppError(
      409,
      'EMAIL_VERIFICATION_NOT_REQUIRED',
      'This queue does not ask customers to verify an email address.',
    );
  }
  if (!isEmailAvailable()) {
    throw new AppError(
      503,
      'EMAIL_VERIFICATION_UNAVAILABLE',
      'Email verification is temporarily unavailable. Please try again later.',
    );
  }

  const normalized = normalizeEmail(input.email);
  if (!normalized) {
    throw new AppError(422, 'INVALID_EMAIL_ADDRESS', 'Enter a valid email address.');
  }

  const emailFingerprint = emailFingerprintFor(queue.id, normalized);
  const now = new Date();

  const existing = await prisma.customerEmailVerification.findFirst({
    where: { queueId: queue.id, emailFingerprint, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    const cooldownMs = env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
    const waitedMs = now.getTime() - existing.lastSentAt.getTime();
    if (waitedMs < cooldownMs) {
      throw new AppError(
        429,
        'VERIFICATION_RESEND_TOO_SOON',
        `Please wait ${Math.ceil((cooldownMs - waitedMs) / 1000)} seconds before requesting another code.`,
      );
    }
  }

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + env.EMAIL_VERIFICATION_CODE_TTL_MINUTES * 60_000);

  // A resend replaces the code on the same row: the previous one stops
  // working, and the attempt counter resets with the new code (a fresh code
  // deserves a fresh budget) while the cooldown above still bounds how often
  // that can happen.
  const verification = existing
    ? await prisma.customerEmailVerification.update({
        where: { id: existing.id },
        data: {
          codeHash: hashEmailCode(existing.id, code),
          expiresAt,
          failedAttempts: 0,
          lastSentAt: now,
        },
      })
    : await createVerificationWithHashedCode(queue.id, emailFingerprint, code, expiresAt);

  const sent = await sendCustomerVerificationCodeEmail({
    to: normalized,
    code,
    queueName: queue.name,
    expiresInMinutes: env.EMAIL_VERIFICATION_CODE_TTL_MINUTES,
  });

  if (!sent) {
    // Never leaves a usable challenge behind for a message that was not sent,
    // and never claims a code is on its way when it is not.
    await prisma.customerEmailVerification
      .delete({ where: { id: verification.id } })
      .catch(() => undefined);
    // No address, no code, no provider detail — an operator needs to know a
    // send failed, not who it was for.
    logger.error({ queueId: queue.id }, 'Customer verification email dispatch failed');
    throw new AppError(
      502,
      'VERIFICATION_SEND_FAILED',
      'We could not send the verification code. Please try again.',
    );
  }

  return {
    verificationId: verification.id,
    expiresAt: verification.expiresAt,
    resendAvailableInSeconds: env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
  };
}

/** The row id seeds the code hash, so it has to exist before hashing — hence
 * the create-then-update rather than one statement. */
async function createVerificationWithHashedCode(
  queueId: string,
  emailFingerprint: string,
  code: string,
  expiresAt: Date,
) {
  const created = await prisma.customerEmailVerification.create({
    data: { queueId, emailFingerprint, codeHash: 'pending', expiresAt },
  });
  return prisma.customerEmailVerification.update({
    where: { id: created.id },
    data: { codeHash: hashEmailCode(created.id, code) },
  });
}

/**
 * Confirms a code and returns a proof the join endpoint can check. The proof
 * — not any client-asserted flag — is what makes an address "verified" as far
 * as the rest of the system is concerned.
 */
export async function confirmCustomerEmailVerification(input: {
  verificationId: string;
  code: string;
  email: string;
}) {
  const verification = await prisma.customerEmailVerification.findUnique({
    where: { id: input.verificationId },
  });
  // One generic failure for "no such challenge", "already used" and
  // "expired": the difference helps an attacker and nobody else.
  if (!verification || verification.consumedAt || verification.expiresAt < new Date()) {
    throw new AppError(
      400,
      'VERIFICATION_INVALID_OR_EXPIRED',
      'This verification code is no longer valid. Please request a new one.',
    );
  }

  if (verification.failedAttempts >= env.EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    throw new AppError(
      429,
      'VERIFICATION_ATTEMPTS_EXCEEDED',
      'Too many incorrect attempts. Please request a new code.',
    );
  }

  const normalized = normalizeEmail(input.email);
  if (!normalized) {
    throw new AppError(422, 'INVALID_EMAIL_ADDRESS', 'Enter a valid email address.');
  }
  // The address confirmed must be the address the challenge was issued for —
  // otherwise a code sent to one mailbox could verify another.
  const emailFingerprint = emailFingerprintFor(verification.queueId, normalized);
  if (emailFingerprint !== verification.emailFingerprint) {
    throw new AppError(
      400,
      'VERIFICATION_EMAIL_MISMATCH',
      'That code was sent to a different email address.',
    );
  }

  if (!emailCodeMatches(verification.id, input.code, verification.codeHash)) {
    // Atomic increment: concurrent wrong guesses must all be counted, which a
    // read-modify-write would lose.
    await prisma.customerEmailVerification.update({
      where: { id: verification.id },
      data: { failedAttempts: { increment: 1 } },
    });
    throw new AppError(400, 'VERIFICATION_CODE_INCORRECT', 'That code is not correct.');
  }

  await prisma.customerEmailVerification.update({
    where: { id: verification.id },
    data: { consumedAt: new Date() },
  });

  return {
    verificationProof: issueEmailVerificationProof(
      verification.queueId,
      emailFingerprint,
      env.EMAIL_VERIFICATION_PROOF_TTL_MINUTES * 60_000,
    ),
    // The client needs to know when to re-verify; the proof itself stays opaque.
    expiresAt: new Date(Date.now() + env.EMAIL_VERIFICATION_PROOF_TTL_MINUTES * 60_000),
  };
}

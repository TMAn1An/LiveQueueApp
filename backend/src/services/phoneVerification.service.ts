import { randomInt } from 'node:crypto';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';
import {
  computeIdentityFingerprint,
  hashPhoneCode,
  issuePhoneVerificationProof,
  normalizePhone,
  phoneCodeMatches,
} from '../utils/customerIdentity';
import { getSmsProvider, isPhoneVerificationAvailable } from './sms.service';
import { describeJoinRequirements } from './queueIdentityPolicy.service';

/**
 * Proving a customer controls a phone number, before they join a queue that
 * identifies people that way.
 *
 * Entirely separate from the service-start verification code on Token: that
 * one proves to *staff* that the person at the counter is the right customer,
 * this one proves to the *server* that a number belongs to whoever is
 * joining. Different lifetimes, different attempt budgets, different secret
 * purpose, different storage. They are never interchangeable (ADR-034).
 */

const CODE_LENGTH = 6;

/** Cryptographically secure, never Math.random — this gates an entitlement. */
function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

function phoneFingerprintFor(queueId: string, normalizedPhone: string): string {
  // Uses the VERIFIED_PHONE namespace so the proof's fingerprint is directly
  // comparable with the identity computed at join time.
  return computeIdentityFingerprint({
    queueId,
    mode: 'VERIFIED_PHONE',
    normalizedPhone,
  });
}

export { phoneFingerprintFor };

/**
 * Starts (or re-sends) a challenge. Resending reuses the row so the cooldown
 * and attempt budget cannot be reset by simply asking again.
 */
export async function startPhoneVerification(input: { queueId: string; phone: string }) {
  const queue = await prisma.queue.findUnique({ where: { id: input.queueId } });
  if (!queue || queue.deletedAt) {
    throw new AppError(404, 'QUEUE_NOT_FOUND', 'Queue not found.');
  }

  // Only queues that actually identify customers by phone may burn SMS.
  const requirements = describeJoinRequirements(queue);
  if (!requirements.requiresVerifiedPhone) {
    throw new AppError(
      409,
      'PHONE_VERIFICATION_NOT_REQUIRED',
      'This queue does not ask customers to verify a phone number.',
    );
  }
  if (!isPhoneVerificationAvailable()) {
    throw new AppError(
      503,
      'PHONE_VERIFICATION_UNAVAILABLE',
      'Phone verification is temporarily unavailable. Please try again later.',
    );
  }

  const normalized = normalizePhone(input.phone);
  if (!normalized) {
    throw new AppError(
      422,
      'INVALID_PHONE_NUMBER',
      'Enter your phone number in international format, for example +8801712345678.',
    );
  }

  const phoneFingerprint = phoneFingerprintFor(queue.id, normalized);
  const now = new Date();

  const existing = await prisma.phoneVerification.findFirst({
    where: { queueId: queue.id, phoneFingerprint, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    const cooldownMs = env.PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
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
  const expiresAt = new Date(now.getTime() + env.PHONE_VERIFICATION_CODE_TTL_MINUTES * 60_000);

  // A resend replaces the code on the same row: the previous one stops
  // working, and the attempt counter resets with the new code (a fresh code
  // deserves a fresh budget) while the cooldown above still bounds how often
  // that can happen.
  const verification = existing
    ? await prisma.phoneVerification.update({
        where: { id: existing.id },
        data: {
          codeHash: hashPhoneCode(existing.id, code),
          expiresAt,
          failedAttempts: 0,
          lastSentAt: now,
        },
      })
    : await createVerificationWithHashedCode(queue.id, phoneFingerprint, code, expiresAt);

  try {
    await getSmsProvider().sendVerificationCode({ phone: normalized, code });
  } catch (err) {
    // Never leaves a usable challenge behind for a message that was not sent.
    await prisma.phoneVerification.delete({ where: { id: verification.id } }).catch(() => undefined);
    logger.error({ err }, 'Phone verification SMS dispatch failed');
    throw new AppError(
      502,
      'VERIFICATION_SEND_FAILED',
      'We could not send the verification code. Please try again.',
    );
  }

  return {
    verificationId: verification.id,
    expiresAt: verification.expiresAt,
    resendAvailableInSeconds: env.PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS,
  };
}

/** The row id seeds the code hash, so it has to exist before hashing — hence
 * the create-then-update rather than one statement. */
async function createVerificationWithHashedCode(
  queueId: string,
  phoneFingerprint: string,
  code: string,
  expiresAt: Date,
) {
  const created = await prisma.phoneVerification.create({
    data: { queueId, phoneFingerprint, codeHash: 'pending', expiresAt },
  });
  return prisma.phoneVerification.update({
    where: { id: created.id },
    data: { codeHash: hashPhoneCode(created.id, code) },
  });
}

/**
 * Confirms a code and returns a short-lived proof the join endpoint can
 * check. The proof — not any client-asserted flag — is what makes a phone
 * "verified" as far as the rest of the system is concerned.
 */
export async function confirmPhoneVerification(input: {
  verificationId: string;
  code: string;
  phone: string;
}) {
  const verification = await prisma.phoneVerification.findUnique({
    where: { id: input.verificationId },
  });
  // One generic failure for "no such challenge", "already used" and "expired":
  // the difference helps an attacker and nobody else.
  if (!verification || verification.consumedAt || verification.expiresAt < new Date()) {
    throw new AppError(
      400,
      'VERIFICATION_INVALID_OR_EXPIRED',
      'This verification code is no longer valid. Please request a new one.',
    );
  }

  if (verification.failedAttempts >= env.PHONE_VERIFICATION_MAX_ATTEMPTS) {
    throw new AppError(
      429,
      'VERIFICATION_ATTEMPTS_EXCEEDED',
      'Too many incorrect attempts. Please request a new code.',
    );
  }

  const normalized = normalizePhone(input.phone);
  if (!normalized) {
    throw new AppError(422, 'INVALID_PHONE_NUMBER', 'Enter your phone number in international format.');
  }
  // The number confirmed must be the number the challenge was issued for —
  // otherwise a code sent to one phone could verify another.
  const phoneFingerprint = phoneFingerprintFor(verification.queueId, normalized);
  if (phoneFingerprint !== verification.phoneFingerprint) {
    throw new AppError(
      400,
      'VERIFICATION_PHONE_MISMATCH',
      'That code was sent to a different phone number.',
    );
  }

  if (!phoneCodeMatches(verification.id, input.code, verification.codeHash)) {
    // Atomic increment: concurrent wrong guesses must all be counted, which a
    // read-modify-write would lose (the same fix ADR-030 made for the
    // service-start OTP).
    await prisma.phoneVerification.update({
      where: { id: verification.id },
      data: { failedAttempts: { increment: 1 } },
    });
    throw new AppError(400, 'VERIFICATION_CODE_INCORRECT', 'That code is not correct.');
  }

  await prisma.phoneVerification.update({
    where: { id: verification.id },
    data: { consumedAt: new Date() },
  });

  return {
    verificationProof: issuePhoneVerificationProof(
      verification.queueId,
      phoneFingerprint,
      env.PHONE_VERIFICATION_PROOF_TTL_MINUTES * 60_000,
    ),
    // The client needs to know when to re-verify; the proof itself stays opaque.
    expiresAt: new Date(Date.now() + env.PHONE_VERIFICATION_PROOF_TTL_MINUTES * 60_000),
  };
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * V2 Checkpoint 7 — the CALLED -> IN_PROGRESS service-start verification
 * code. A customer tells staff this code verbally; staff enters it; only a
 * correct, unexpired code lets the backend transition the token.
 *
 * Storage design: a 6-digit code has too little entropy for an unsalted or
 * even a plain keyed hash to fully resist offline brute force once leaked,
 * so this never persists the raw code. But unlike a typical secret, the
 * *owning customer* must also be able to re-fetch the SAME still-valid code
 * on a later poll (app restart, screen revisit) without the backend minting
 * a fresh one on every read (see token.service.ts's
 * getServiceStartVerificationCode) — a one-way hash can verify a guess but
 * can never answer "what was the code," which rules out plain
 * HMAC-as-storage here. Reversible, keyed AES-256-GCM authenticated
 * encryption satisfies both: OTP_SECRET (never client-visible, separate
 * from JWT_SECRET) is required to decrypt, tampering with the stored
 * ciphertext is detected (GCM auth tag) rather than silently decrypting to
 * garbage, and the tokenId is bound in as additional authenticated data so
 * one token's ciphertext can never be replayed against another's row.
 */

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;
export const OTP_MAX_FAILED_ATTEMPTS = 5;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// SHA-256-derives a fixed 32-byte AES-256 key from OTP_SECRET, so the env
// var only needs to meet the same "sufficiently long random string"
// convention Zod already enforces (min 32 chars), not be exactly 32 raw
// bytes itself.
const KEY = createHash('sha256').update(env.OTP_SECRET).digest();

/** Cryptographically secure — never Math.random(), never derived from any
 * token/device/queue identifier or a timestamp (CLAUDE.md security rules). */
export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
}

/** `iv:authTag:ciphertext`, all hex — one self-contained stored string. */
export function encryptOtpCode(tokenId: string, code: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  cipher.setAAD(Buffer.from(tokenId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString('hex')).join(':');
}

/** Null on any failure — wrong key, wrong tokenId, or a corrupted/tampered
 * stored value all fail the GCM auth-tag check the same way; never throws,
 * so callers can treat "can't decrypt" identically to "no code issued." */
export function decryptOtpCode(tokenId: string, stored: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = stored.split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    decipher.setAAD(Buffer.from(tokenId, 'utf8'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/** Timing-safe: decrypts once, then compares fixed-length buffers via
 * crypto.timingSafeEqual rather than a variable-time `===` string compare. */
export function verifyOtpCode(tokenId: string, candidate: string, stored: string): boolean {
  const actual = decryptOtpCode(tokenId, stored);
  if (actual === null) return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  RepeatIdentityMode,
  RepeatRestrictionType,
  RepeatRestrictionUnit,
} from '@prisma/client';
import { env } from '../config/env';

/**
 * Turning what a customer typed into a stable identity.
 *
 * Two rules govern everything here:
 *
 *  1. **Never compare raw input.** "+880 1712-345678" and "+8801712345678"
 *     are one person; "  12345 " and "12345" are one person. Comparison
 *     happens on a canonical form, never on what was typed.
 *  2. **Never store the identity itself for comparison.** The uniqueness
 *     table holds an HMAC fingerprint. The raw answer still lives in the
 *     token's form data under the existing staff-visible rules — that is
 *     unchanged — but the repeat-matching machinery never needs a second
 *     copy of someone's national ID.
 */

/** Domain separation: the same secret must never produce the same output
 * for two different purposes. */
const PURPOSE_IDENTITY = 'livequeue:identity:v1';
const PURPOSE_PHONE_CODE = 'livequeue:phone-code:v1';
const PURPOSE_PHONE_PROOF = 'livequeue:phone-proof:v1';
// ADR-037. Separate purposes from the phone pair above, and separate again
// from the staff/owner email verification in ADR-024 — proving a customer
// can read a mailbox is a different claim from an owner proving they control
// an account, and a value from one must never satisfy the other.
const PURPOSE_EMAIL_CODE = 'livequeue:customer-email-code:v1';
const PURPOSE_EMAIL_PROOF = 'livequeue:customer-email-proof:v1';

function hmac(purpose: string, material: string): string {
  return createHmac('sha256', env.CUSTOMER_IDENTITY_SECRET)
    .update(`${purpose}\0${material}`)
    .digest('hex');
}

/**
 * Canonical phone form. The app is required to submit an international
 * number: without a country there is no way to tell whether "01712345678"
 * and "+8801712345678" are the same person, and guessing a country from the
 * server's own location is exactly the kind of silent assumption that makes
 * identity wrong for travellers.
 *
 * Everything that is pure formatting — spaces, dashes, brackets, dots — is
 * removed; a leading `00` international prefix becomes `+`. Nothing else is
 * altered, so no meaningful digit is ever discarded.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/[\s\-().]/g, '');
  const withPlus = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (!withPlus.startsWith('+')) {
    return null;
  }

  const digits = withPlus.slice(1);
  // E.164: 1–3 digit country code plus subscriber number, 15 digits total.
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return null;
  }
  return `+${digits}`;
}

/**
 * Canonical form for a free-text identifier such as a national ID, student
 * number or passport.
 *
 *  - Unicode NFKC first, so visually identical characters typed from
 *    different keyboards do not read as different people.
 *  - Outer whitespace trimmed and internal runs collapsed to one space.
 *  - Upper-cased. Identifiers of this kind are conventionally
 *    case-insensitive ("ab-123" and "AB-123" are one document), and treating
 *    them otherwise would let one person hold two entitlements just by
 *    changing shift key. Documented deliberately rather than assumed.
 *
 * Internal punctuation is deliberately preserved: a hyphen or slash can be
 * part of the real number, and stripping it could merge two different people.
 */
export function normalizeCustomIdentity(raw: string): string | null {
  const canonical = raw.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
  return canonical.length > 0 ? canonical : null;
}

/**
 * The value actually stored and compared. Bound to the queue and the mode,
 * so a fingerprint means nothing in another queue, and changing a queue's
 * identity method starts a fresh namespace rather than silently re-matching
 * old visitors against a new rule (see ADR-034 on prospective policy change).
 */
export function computeIdentityFingerprint(input: {
  queueId: string;
  mode: RepeatIdentityMode;
  /**
   * The verified contact this identity rests on — a phone fingerprint under
   * the legacy phone modes, an email fingerprint under the ADR-037 email
   * ones. One slot rather than two because a queue uses exactly one verified
   * channel, and the mode is already part of the material below, so an email
   * and a phone can never collide even if the same string arrived in both.
   *
   * Its position in `parts` is deliberately unchanged from ADR-034: moving
   * it would silently invalidate every fingerprint already recorded.
   */
  normalizedVerifiedContact?: string | null;
  normalizedCustomValue?: string | null;
}): string {
  const parts = [
    input.queueId,
    input.mode,
    input.normalizedVerifiedContact ?? '',
    input.normalizedCustomValue ?? '',
  ];
  // Length-prefixed so no combination of values can be re-parsed as another.
  const material = parts.map((part) => `${part.length}:${part}`).join('|');
  return hmac(PURPOSE_IDENTITY, material);
}

/**
 * Canonical email form (ADR-037).
 *
 * Deliberately conservative. The domain is lower-cased, because DNS is
 * case-insensitive and nobody disputes that. The local part is *also*
 * lower-cased — a documented product choice rather than a standards one:
 * RFC 5321 permits case-sensitive local parts, but no mailbox provider a
 * customer is likely to use actually treats `Person@` and `person@` as two
 * people, and treating them as two would hand one person two entitlements
 * for pressing shift.
 *
 * What this deliberately does **not** do is guess provider-specific mailbox
 * equivalence: no dot-stripping, no `+tag` removal. Those rules are true at
 * Gmail and false elsewhere, and applying them everywhere would merge
 * genuinely different people at any provider that treats dots as
 * significant. Being wrong in that direction denies somebody a service they
 * are entitled to.
 */
export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  // Enough structure to be a deliverable address; the real check is whether
  // the code that gets sent to it is ever read back.
  if (/\s/.test(trimmed) || !/^[^@\s]+$/.test(local)) return null;
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(domain)) {
    return null;
  }
  if (trimmed.length > 254) return null;

  return `${local.toLowerCase()}@${domain.toLowerCase()}`;
}

/** One-way hash of a phone verification code. Nothing ever reads the code
 * back — unlike the service-start OTP, which the owning customer re-fetches
 * — so a hash is strictly better than reversible storage here. */
export function hashPhoneCode(verificationId: string, code: string): string {
  return hmac(PURPOSE_PHONE_CODE, `${verificationId}\0${code}`);
}

export function phoneCodeMatches(verificationId: string, code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashPhoneCode(verificationId, code));
  const stored = Buffer.from(storedHash);
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

interface PhoneProofPayload {
  queueId: string;
  phoneFingerprint: string;
  exp: number;
}

/**
 * A short-lived signed statement that *this server* verified *this number*
 * for *this queue*. The join endpoint trusts this and never a client-supplied
 * `verified: true`.
 *
 * Carries a fingerprint rather than the number itself: the client already
 * knows its own phone, so putting it in the token would only widen where the
 * value travels.
 */
export function issuePhoneVerificationProof(
  queueId: string,
  phoneFingerprint: string,
  ttlMs: number,
): string {
  const payload: PhoneProofPayload = {
    queueId,
    phoneFingerprint,
    exp: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${hmac(PURPOSE_PHONE_PROOF, encoded)}`;
}

/**
 * Returns the proof's phone fingerprint when it is genuinely this server's,
 * unexpired, and issued for this exact queue — otherwise null. Every failure
 * mode collapses to null on purpose: a caller has no use for the difference
 * between "tampered" and "expired", and neither does an attacker.
 */
export function verifyPhoneVerificationProof(proof: string, queueId: string): string | null {
  const [encoded, signature] = proof.split('.');
  if (!encoded || !signature) return null;

  const expected = Buffer.from(hmac(PURPOSE_PHONE_PROOF, encoded));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  let payload: PhoneProofPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as PhoneProofPayload;
  } catch {
    return null;
  }

  if (payload.queueId !== queueId) return null;
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload.phoneFingerprint ?? null;
}

/**
 * ADR-037's email equivalents of the four functions above.
 *
 * Same shapes, different purpose strings — which is the whole point. A code
 * or proof minted for one channel can never satisfy the other, and neither
 * can satisfy the account-verification flow in ADR-024, because the HMAC
 * material differs at the first byte.
 */
export function hashEmailCode(verificationId: string, code: string): string {
  return hmac(PURPOSE_EMAIL_CODE, `${verificationId} ${code}`);
}

export function emailCodeMatches(verificationId: string, code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashEmailCode(verificationId, code));
  const stored = Buffer.from(storedHash);
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

interface EmailProofPayload {
  queueId: string;
  emailFingerprint: string;
  exp: number;
}

/**
 * A short-lived signed statement that *this server* saw *this mailbox*
 * receive and return a code, for *this queue*. The join endpoint trusts this
 * and never a client-supplied `verified: true`.
 *
 * Carries a fingerprint rather than the address: the client already knows
 * its own email, so putting it in the proof would only widen where the value
 * travels.
 */
export function issueEmailVerificationProof(
  queueId: string,
  emailFingerprint: string,
  ttlMs: number,
): string {
  const payload: EmailProofPayload = {
    queueId,
    emailFingerprint,
    exp: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${hmac(PURPOSE_EMAIL_PROOF, encoded)}`;
}

/**
 * Returns the proof's email fingerprint when it is genuinely this server's,
 * unexpired, and issued for this exact queue — otherwise null. Every failure
 * mode collapses to null on purpose: a caller has no use for the difference
 * between "tampered", "expired" and "issued for somewhere else", and neither
 * does an attacker.
 */
export function verifyEmailVerificationProof(proof: string, queueId: string): string | null {
  const [encoded, signature] = proof.split('.');
  if (!encoded || !signature) return null;

  const expected = Buffer.from(hmac(PURPOSE_EMAIL_PROOF, encoded));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  let payload: EmailProofPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as EmailProofPayload;
  } catch {
    return null;
  }

  if (payload.queueId !== queueId) return null;
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload.emailFingerprint ?? null;
}

/** Milliseconds in the units that are pure elapsed time. */
const EXACT_UNIT_MS: Partial<Record<RepeatRestrictionUnit, number>> = {
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 604_800_000,
};

export interface RepeatWindow {
  type: RepeatRestrictionType;
  amount?: number | null;
  unit?: RepeatRestrictionUnit | null;
  until?: Date | null;
}

/**
 * When a customer who was served at `consumedAt` may use the queue again, or
 * null for never (ADR-035).
 *
 * Two kinds of arithmetic, and the difference is the whole point:
 *
 *  - MINUTE/HOUR/DAY/WEEK are **elapsed time**. "Again after 12 hours" means
 *    twelve hours, wherever anyone is and whatever the clocks do. No timezone
 *    is involved, so none is required.
 *  - MONTH/YEAR are **calendar increments**, because that is what the words
 *    mean: a month after 31 January is 28 February, not "30 days later". That
 *    needs a calendar, and a calendar needs a timezone — the queue's own, so
 *    the answer never depends on where the customer is standing.
 *
 * Month-end is clamped rather than allowed to roll over: 31 January plus one
 * month is the last day of February, not 3 March. Rolling over would let a
 * customer back a few days early, which is the wrong direction to be wrong in.
 */
export function computeEligibleAgainAt(
  window: RepeatWindow,
  consumedAt: Date,
  timezone: string | null,
): Date | null {
  if (window.type === 'ONCE_EVER') {
    return null;
  }
  if (window.type === 'UNTIL_DATETIME') {
    if (!window.until) {
      throw new Error('An UNTIL_DATETIME restriction requires a cutoff instant.');
    }
    return window.until;
  }

  const amount = window.amount;
  const unit = window.unit;
  if (!amount || amount <= 0 || !unit) {
    throw new Error('A DURATION restriction requires a positive amount and a unit.');
  }

  const exactMs = EXACT_UNIT_MS[unit];
  if (exactMs !== undefined) {
    return new Date(consumedAt.getTime() + amount * exactMs);
  }

  if (!timezone) {
    // Unreachable through the API — configuration validation demands a
    // timezone for month/year windows — but never silently guess one.
    throw new Error('A month or year restriction requires a queue timezone.');
  }
  return addCalendarUnits(consumedAt, unit === 'YEAR' ? amount * 12 : amount, timezone);
}

/**
 * Adds whole months to an instant as a person reading a calendar would, in a
 * given zone: the local wall-clock time is kept and only the date advances,
 * so the result stays at the same time of day even across a daylight-saving
 * change.
 */
function addCalendarUnits(instant: Date, months: number, timezone: string): Date {
  const local = localParts(instant, timezone);

  const targetMonthIndex = local.month - 1 + months;
  const targetYear = local.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1;
  // Clamp, never roll over: 31 January + 1 month is the end of February.
  const targetDay = Math.min(local.day, daysInMonth(targetYear, targetMonth));

  return instantFromLocalParts(
    { year: targetYear, month: targetMonth, day: targetDay, hour: local.hour, minute: local.minute, second: local.second },
    timezone,
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  // Intl renders midnight as hour 24 in some engines/locales; normalize it.
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * The inverse of [localParts]: the instant at which the given wall-clock time
 * occurs in the given zone.
 *
 * A zone's offset can itself depend on the instant (daylight saving), so this
 * guesses using UTC, measures how far off the guess renders in that zone, and
 * corrects — twice, which is enough to settle even when the correction crosses
 * the transition itself. No date library, and no hand-written offset table.
 */
export function instantFromLocalParts(parts: LocalParts, timezone: string): Date {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  for (let i = 0; i < 2; i += 1) {
    const rendered = localParts(new Date(guess), timezone);
    const renderedUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
    );
    const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    if (renderedUtc === target) {
      break;
    }
    guess += target - renderedUtc;
  }
  return new Date(guess);
}

/** Whether a duration unit needs the queue's calendar, and therefore its
 * timezone, to be evaluated at all. */
export function unitNeedsTimezone(unit: RepeatRestrictionUnit): boolean {
  return unit === 'MONTH' || unit === 'YEAR';
}

/** Whether a string names a zone this runtime actually knows. Rejecting an
 * unknown zone at configuration time is what keeps computePeriodKey total. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Phase 4 (schedule/sessions): "now," decomposed the way a weekly schedule
 * needs it — which local calendar date and weekday this instant falls on in
 * the queue's zone, and how far into that day it is. */
export interface QueueLocalMoment {
  /** Midnight UTC of the local calendar date — a DATE value, never a real
   * instant. Two moments on the same local date always produce an equal
   * dateKey via `Date#getTime()`, which is all Token.assignedSessionDate
   * comparisons need. */
  dateKey: Date;
  /** 0 = Sunday .. 6 = Saturday (`Date.prototype.getUTCDay()` convention),
   * derived from the local calendar date itself — day-of-week depends only
   * on the date, never on the zone's offset at this instant. */
  weekday: number;
  /** Minutes since local midnight, 0-1439. */
  minuteOfDay: number;
}

export function resolveLocalMoment(instant: Date, timezone: string): QueueLocalMoment {
  const local = localParts(instant, timezone);
  const dateKey = new Date(Date.UTC(local.year, local.month - 1, local.day));
  return {
    dateKey,
    weekday: dateKey.getUTCDay(),
    minuteOfDay: local.hour * 60 + local.minute,
  };
}

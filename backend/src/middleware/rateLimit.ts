import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Disabled during the automated test suite by default: the integration
 * suite drives far more requests than any real limit from a single address
 * (127.0.0.1) as a natural consequence of test volume, not anything a
 * limiter is meant to catch. Production and development enforce every
 * limiter below normally. RATE_LIMIT_TEST_ENFORCE flips this off for one
 * isolated test file that needs to actually trigger 429s — see
 * tests/rateLimit.test.ts; every other test file never sets it.
 */
function shouldSkip() {
  return env.NODE_ENV === 'test' && !env.RATE_LIMIT_TEST_ENFORCE;
}

function createLimiter(windowMs: number, max: number) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkip,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    },
  });
}

/** Login/register/refresh — brute-force and credential-stuffing protection. */
export const authRateLimiter = createLimiter(15 * 60 * 1000, 20);

/**
 * Public, unauthenticated read/register endpoints: public queue config,
 * device registration, and the customer-facing token get/status lookups.
 * Kept separate from tokenCreateRateLimiter — a flood of read-only polling
 * must not consume the budget for the actual token-creation write path.
 */
export const publicRateLimiter = createLimiter(
  env.RATE_LIMIT_PUBLIC_WINDOW_MS,
  env.RATE_LIMIT_PUBLIC_MAX,
);

/**
 * POST /api/tokens only — the single most business-critical public write.
 * A genuinely separate limiter instance (own MemoryStore), not a shared
 * counter with publicRateLimiter, so exhausting one never blocks the other.
 */
export const tokenCreateRateLimiter = createLimiter(
  env.RATE_LIMIT_TOKEN_CREATE_WINDOW_MS,
  env.RATE_LIMIT_TOKEN_CREATE_MAX,
);

/**
 * Sensitive authenticated mutations: staff create/update/delete,
 * organization deletion, blocked-device status changes. Deliberately not
 * applied to every authenticated endpoint — see docs/PROGRESS.md Phase 7
 * notes for which routes were considered and excluded.
 */
export const sensitiveRateLimiter = createLimiter(
  env.RATE_LIMIT_SENSITIVE_WINDOW_MS,
  env.RATE_LIMIT_SENSITIVE_MAX,
);

/** Reports/export — the most expensive aggregate queries in the codebase. */
export const reportRateLimiter = createLimiter(
  env.RATE_LIMIT_REPORT_WINDOW_MS,
  env.RATE_LIMIT_REPORT_MAX,
);

/**
 * Email-verification send/resend (V2 Checkpoint 2) — deliberately its own,
 * tighter category rather than reusing authRateLimiter/sensitiveRateLimiter:
 * this is the only rate-limited action in the app that costs a real email
 * send, so "prevent email abuse" warrants a stricter default (3/15min) than
 * either existing category.
 */
export const emailRateLimiter = createLimiter(env.RATE_LIMIT_EMAIL_WINDOW_MS, env.RATE_LIMIT_EMAIL_MAX);

/**
 * Phone verification start/confirm. Its own category for the same reason
 * emailRateLimiter has one: a start request costs a real SMS, which is both
 * money and a way to harass a stranger's phone. Deliberately the tightest
 * default in the app. The per-number resend cooldown in
 * phoneVerification.service.ts is a separate, complementary limit — this one
 * bounds a single caller, that one bounds a single phone number.
 */
export const phoneVerificationRateLimiter = createLimiter(
  env.RATE_LIMIT_PHONE_VERIFICATION_WINDOW_MS,
  env.RATE_LIMIT_PHONE_VERIFICATION_MAX,
);

/**
 * ADR-037: customer email verification. A start request costs a real email,
 * so this is as tight as the SMS bucket above.
 *
 * Two complementary limits, as with phone: this one bounds a single caller
 * (by address, the shared `createLimiter` key), while the per-challenge
 * cooldown in customerEmailVerification.service.ts bounds a single mailbox
 * however many callers ask for it. Neither alone is enough — the first would
 * let a client cycle mailboxes, the second would let many clients hammer one.
 */
export const customerEmailVerificationRateLimiter = createLimiter(
  env.RATE_LIMIT_CUSTOMER_EMAIL_VERIFICATION_WINDOW_MS,
  env.RATE_LIMIT_CUSTOMER_EMAIL_VERIFICATION_MAX,
);

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

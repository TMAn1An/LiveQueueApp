import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Applied to login/register/refresh — brute-force and credential-stuffing
 * protection. Skipped in the test environment: the integration suite drives
 * far more than 20 requests/15min from a single address (127.0.0.1) as a
 * natural consequence of test volume, not anything this limiter is meant to
 * catch. Production and development both enforce it normally.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
  },
});

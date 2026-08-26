import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { authRateLimiter, emailRateLimiter, sensitiveRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  verifyEmailSchema,
} from '../validators/auth.validators';

const router = Router();

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.get('/me', authenticate, authController.me);
router.post('/logout', authenticate, validate(logoutSchema), authController.logout);
router.post('/refresh', authRateLimiter, validate(refreshSchema), authController.refresh);
router.patch(
  '/password',
  authenticate,
  sensitiveRateLimiter,
  validate(changePasswordSchema),
  authController.changePassword,
);

// V2 Checkpoint 2 (ADR-024). Public — the token itself is the credential;
// deliberately reachable without `authenticate` so a link clicked in a
// different browser/session than the one that registered still works.
router.get(
  '/email-verification/verify',
  authRateLimiter,
  validate(verifyEmailSchema),
  authController.verifyEmail,
);
// Authenticated — a PENDING_EMAIL_VERIFICATION staff member passes
// `authenticate` (it only rejects SUSPENDED), so this stays reachable from
// the dashboard's own verification-required state.
router.post(
  '/email-verification/resend',
  authenticate,
  emailRateLimiter,
  authController.resendVerificationEmail,
);

export default router;

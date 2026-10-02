import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import {
  authRateLimiter,
  emailRateLimiter,
  passwordResetRateLimiter,
  publicRateLimiter,
  sensitiveRateLimiter,
} from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  organizationNameAvailabilitySchema,
  refreshSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  resetTokenQuerySchema,
  verifyEmailSchema,
} from '../validators/auth.validators';
import { acceptInvitationSchema } from '../validators/staff.validators';

const router = Router();

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
// Public: asked while someone types an organization name on the sign-up
// form, before any account exists. Rate-limited like other public reads.
router.get(
  '/organization-name-availability',
  publicRateLimiter,
  validate(organizationNameAvailabilitySchema),
  authController.organizationNameAvailability,
);
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

// ADR-035: an invited staff member sets their own password here. Public for
// the same reason as email verification below — the link is the credential,
// and it is clicked in a browser with no session.
router.post(
  '/accept-invitation',
  authRateLimiter,
  validate(acceptInvitationSchema),
  authController.acceptInvitation,
);

// ADR-058: forgot password. All public. The request has its own per-IP
// limiter (and a per-account cooldown in the service); the
// check and confirm steps share the login limiter, which already exists to
// slow guessing.
router.post(
  '/password-reset/request',
  passwordResetRateLimiter,
  validate(requestPasswordResetSchema),
  authController.requestPasswordReset,
);
router.get(
  '/password-reset/validate',
  authRateLimiter,
  validate(resetTokenQuerySchema),
  authController.validatePasswordResetToken,
);
router.post(
  '/password-reset/confirm',
  authRateLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword,
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

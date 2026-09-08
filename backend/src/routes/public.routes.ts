import { Router } from 'express';
import * as publicController from '../controllers/public.controller';
import { phoneVerificationRateLimiter, publicRateLimiter } from '../middleware/rateLimit';
import * as phoneVerificationController from '../controllers/phoneVerification.controller';
import {
  confirmPhoneVerificationSchema,
  startPhoneVerificationSchema,
} from '../validators/phoneVerification.validators';
import { validate } from '../middleware/validate';
import { appVersionPolicySchema, publicQueueConfigSchema } from '../validators/public.validators';

const router = Router();

router.get(
  '/queues/:queueId/config',
  publicRateLimiter,
  validate(publicQueueConfigSchema),
  publicController.getQueueConfig,
);

// V2 Checkpoint 9 (ADR-031): server-authoritative mobile version policy —
// same public trust model as the queue-config endpoint above (no auth, no
// tenant scope, no customer PII).
router.get(
  '/version-policy',
  publicRateLimiter,
  validate(appVersionPolicySchema),
  publicController.getAppVersionPolicy,
);

/**
 * Phone verification (ADR-034) — public and unauthenticated, exactly like
 * every other customer-facing route: the customer has no account. Its own
 * limiter because a start request costs a real SMS.
 */
router.post(
  '/phone-verification/start',
  phoneVerificationRateLimiter,
  validate(startPhoneVerificationSchema),
  phoneVerificationController.start,
);
router.post(
  '/phone-verification/confirm',
  phoneVerificationRateLimiter,
  validate(confirmPhoneVerificationSchema),
  phoneVerificationController.confirm,
);

export default router;

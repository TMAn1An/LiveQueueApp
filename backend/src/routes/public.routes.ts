import { Router } from 'express';
import * as publicController from '../controllers/public.controller';
import {
  customerEmailVerificationRateLimiter,
  phoneVerificationRateLimiter,
  publicRateLimiter,
} from '../middleware/rateLimit';
import * as phoneVerificationController from '../controllers/phoneVerification.controller';
import * as customerEmailVerificationController from '../controllers/customerEmailVerification.controller';
import {
  confirmPhoneVerificationSchema,
  startPhoneVerificationSchema,
} from '../validators/phoneVerification.validators';
import {
  confirmCustomerEmailVerificationSchema,
  startCustomerEmailVerificationSchema,
} from '../validators/customerEmailVerification.validators';
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

/**
 * ADR-037: customer email verification — public and unauthenticated for the
 * same reason as every other customer route, with its own limiter because a
 * start request costs a real email.
 */
router.post(
  '/email-verification/start',
  customerEmailVerificationRateLimiter,
  validate(startCustomerEmailVerificationSchema),
  customerEmailVerificationController.start,
);
router.post(
  '/email-verification/confirm',
  customerEmailVerificationRateLimiter,
  validate(confirmCustomerEmailVerificationSchema),
  customerEmailVerificationController.confirm,
);

export default router;

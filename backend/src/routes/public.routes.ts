import { Router } from 'express';
import * as publicController from '../controllers/public.controller';
import { publicRateLimiter } from '../middleware/rateLimit';
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

export default router;

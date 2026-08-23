import { Router } from 'express';
import * as publicController from '../controllers/public.controller';
import { publicRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { publicQueueConfigSchema } from '../validators/public.validators';

const router = Router();

router.get(
  '/queues/:queueId/config',
  publicRateLimiter,
  validate(publicQueueConfigSchema),
  publicController.getQueueConfig,
);

export default router;

import { Router } from 'express';
import * as counterController from '../controllers/counter.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { requireVerified } from '../middleware/requireVerified';
import { validate } from '../middleware/validate';
import {
  assignCounterSchema,
  counterIdOnlySchema,
  updateCounterSchema,
  updateCounterStatusSchema,
} from '../validators/counter.validators';

const router = Router();

// Direct counter-id operations verify ownership through the parent queue
// (counter → queue → organizationId) inside the service layer, not here.
router.put(
  '/:counterId',
  authenticate,
  requireVerified,
  requirePermission('manage_counters'),
  validate(updateCounterSchema),
  counterController.update,
);
router.delete(
  '/:counterId',
  authenticate,
  requireVerified,
  requirePermission('manage_counters'),
  validate(counterIdOnlySchema),
  counterController.remove,
);
router.patch(
  '/:counterId/status',
  authenticate,
  requireVerified,
  requirePermission('manage_counters'),
  validate(updateCounterStatusSchema),
  counterController.updateStatus,
);
router.patch(
  '/:counterId/assign',
  authenticate,
  requireVerified,
  requirePermission('manage_counters'),
  validate(assignCounterSchema),
  counterController.assign,
);

export default router;

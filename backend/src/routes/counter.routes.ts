import { Router } from 'express';
import * as counterController from '../controllers/counter.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { requireVerified } from '../middleware/requireVerified';
import { validate } from '../middleware/validate';
import {
  assignableStaffSchema,
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
// Who may operate a counter is a counter concern; who *stands* at it is a
// staffing decision, and ordinary STAFF must not be able to make it — they
// hold manage_counters (so they can put their own counter on break) but not
// manage_staff. Reusing that existing permission rather than inventing one.
router.get(
  '/:counterId/available-staff',
  authenticate,
  requireVerified,
  requirePermission('manage_staff'),
  validate(assignableStaffSchema),
  counterController.assignableStaff,
);
router.patch(
  '/:counterId/assign',
  authenticate,
  requireVerified,
  requirePermission('manage_staff'),
  validate(assignCounterSchema),
  counterController.assign,
);

export default router;

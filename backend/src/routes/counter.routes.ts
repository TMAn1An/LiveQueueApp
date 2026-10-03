import { Router } from 'express';
import * as counterController from '../controllers/counter.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { COUNTER_MANAGEMENT_DENIAL } from '../services/counterAccess.service';
import { requireVerified } from '../middleware/requireVerified';
import { validate } from '../middleware/validate';
import {
  assignableStaffSchema,
  assignCounterSchema,
  counterIdOnlySchema,
  setCounterServicesSchema,
  updateCounterSchema,
  updateCounterStatusSchema,
} from '../validators/counter.validators';

const router = Router();

// ADR-064: only OWNER and ADMIN decide who stands at which counter.
const COUNTER_ASSIGNMENT_DENIAL = {
  code: 'COUNTER_ASSIGNMENT_FORBIDDEN',
  message: "Only the queue's Admin or the Organization Head can manage counter assignments.",
};

// ADR-064: the signed-in person's own counter — the only one they may claim
// from. Any role; the answer is always about the caller.
router.get('/mine', authenticate, requireVerified, counterController.mine);

// Direct counter-id operations verify ownership through the parent queue
// (counter → queue → organizationId) inside the service layer, not here.
router.put(
  '/:counterId',
  authenticate,
  requireVerified,
  requirePermission('manage_counters', COUNTER_MANAGEMENT_DENIAL),
  validate(updateCounterSchema),
  counterController.update,
);
// ADR-064: creating, renaming, opening/closing and deleting counters is
// OWNER/ADMIN management (manage_counters, which STAFF do not hold).
router.delete(
  '/:counterId',
  authenticate,
  requireVerified,
  requirePermission('manage_counters', COUNTER_MANAGEMENT_DENIAL),
  validate(counterIdOnlySchema),
  counterController.remove,
);
router.patch(
  '/:counterId/status',
  authenticate,
  requireVerified,
  requirePermission('manage_counters', COUNTER_MANAGEMENT_DENIAL),
  validate(updateCounterStatusSchema),
  counterController.updateStatus,
);
// Who stands at a counter is a staffing decision (manage_staff, OWNER/ADMIN).
// ADR-070: service routing is counter configuration.
router.put(
  '/:counterId/services',
  authenticate,
  requireVerified,
  requirePermission('manage_counters', COUNTER_MANAGEMENT_DENIAL),
  validate(setCounterServicesSchema),
  counterController.setServices,
);
router.get(
  '/:counterId/available-staff',
  authenticate,
  requireVerified,
  requirePermission('manage_staff', COUNTER_ASSIGNMENT_DENIAL),
  validate(assignableStaffSchema),
  counterController.assignableStaff,
);
router.patch(
  '/:counterId/assign',
  authenticate,
  requireVerified,
  requirePermission('manage_staff', COUNTER_ASSIGNMENT_DENIAL),
  validate(assignCounterSchema),
  counterController.assign,
);

export default router;

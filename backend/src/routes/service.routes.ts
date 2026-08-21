import { Router } from 'express';
import * as serviceController from '../controllers/service.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  serviceIdOnlySchema,
  updateServiceSchema,
  updateServiceStatusSchema,
} from '../validators/service.validators';

const router = Router();

// Direct service-id operations verify ownership through the parent queue
// (service → queue → organizationId) inside the service layer, not here.
router.put(
  '/:serviceId',
  authenticate,
  requirePermission('manage_services'),
  validate(updateServiceSchema),
  serviceController.update,
);
router.delete(
  '/:serviceId',
  authenticate,
  requirePermission('manage_services'),
  validate(serviceIdOnlySchema),
  serviceController.remove,
);
router.patch(
  '/:serviceId/status',
  authenticate,
  requirePermission('manage_services'),
  validate(updateServiceStatusSchema),
  serviceController.updateStatus,
);

export default router;

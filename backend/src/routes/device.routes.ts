import { Router } from 'express';
import * as deviceController from '../controllers/device.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  listDevicesSchema,
  registerDeviceSchema,
  updateDeviceStatusSchema,
} from '../validators/device.validators';

const router = Router();

// Public — a customer's device has no staff account (ADR-011).
router.post('/register', validate(registerDeviceSchema), deviceController.register);

// Staff-only, global (not tenant-scoped — see ADR-019: Device has no
// organizationId by design, ADR-011/ADR-016 decision 6).
router.get(
  '/',
  authenticate,
  requirePermission('manage_blocked_devices'),
  validate(listDevicesSchema),
  deviceController.list,
);
router.patch(
  '/:deviceId/status',
  authenticate,
  requirePermission('manage_blocked_devices'),
  validate(updateDeviceStatusSchema),
  deviceController.updateStatus,
);

export default router;

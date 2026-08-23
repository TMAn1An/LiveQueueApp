import { Router } from 'express';
import * as deviceController from '../controllers/device.controller';
import { authenticate } from '../middleware/authenticate';
import { publicRateLimiter, sensitiveRateLimiter } from '../middleware/rateLimit';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  listDevicesSchema,
  registerDeviceSchema,
  registerFcmTokenSchema,
  updateDeviceStatusSchema,
} from '../validators/device.validators';

const router = Router();

// Public — a customer's device has no staff account (ADR-011).
router.post('/register', publicRateLimiter, validate(registerDeviceSchema), deviceController.register);

// Public, same trust model as /register — Phase 7 Step 7.
router.post(
  '/fcm-token',
  publicRateLimiter,
  validate(registerFcmTokenSchema),
  deviceController.registerFcmToken,
);

// Staff-only, global (not tenant-scoped — see ADR-019: Device has no
// organizationId by design, ADR-011/ADR-016 decision 6). GET (list) is not
// rate-limited — it's a read, and manage_blocked_devices already restricts
// it to staff who need it; PATCH (status change) is a sensitive mutation.
router.get(
  '/',
  authenticate,
  requirePermission('manage_blocked_devices'),
  validate(listDevicesSchema),
  deviceController.list,
);
router.patch(
  '/:deviceId/status',
  sensitiveRateLimiter,
  authenticate,
  requirePermission('manage_blocked_devices'),
  validate(updateDeviceStatusSchema),
  deviceController.updateStatus,
);

export default router;

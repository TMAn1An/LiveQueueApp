import { Router } from 'express';
import * as deviceController from '../controllers/device.controller';
import { authenticate } from '../middleware/authenticate';
import { publicRateLimiter, sensitiveRateLimiter } from '../middleware/rateLimit';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  deviceBlockActionSchema,
  listDevicesSchema,
  registerDeviceSchema,
  registerFcmTokenSchema,
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

// Staff-only. Device identity itself is global (ADR-011/ADR-016 decision 6),
// but blocking is organization-scoped (OrganizationDeviceBlock) — an
// organization only ever sees and manages its own block relationships,
// never another organization's. GET (list) is not rate-limited — it's a
// read, and manage_blocked_devices already restricts it to staff who need
// it; block/unblock are sensitive mutations.
router.get(
  '/',
  authenticate,
  requirePermission('manage_blocked_devices'),
  validate(listDevicesSchema),
  deviceController.list,
);
router.post(
  '/:deviceId/block',
  sensitiveRateLimiter,
  authenticate,
  requirePermission('manage_blocked_devices'),
  validate(deviceBlockActionSchema),
  deviceController.block,
);
router.delete(
  '/:deviceId/block',
  sensitiveRateLimiter,
  authenticate,
  requirePermission('manage_blocked_devices'),
  validate(deviceBlockActionSchema),
  deviceController.unblock,
);

export default router;

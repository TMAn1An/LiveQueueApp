import { Router } from 'express';
import * as staffController from '../controllers/staff.controller';
import { authenticate } from '../middleware/authenticate';
import { sensitiveRateLimiter } from '../middleware/rateLimit';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  createStaffSchema,
  listStaffSchema,
  staffIdOnlySchema,
  updateStaffSchema,
} from '../validators/staff.validators';

const router = Router();

// Any authenticated staff member of the organization may read (matching the
// Phase 2 read-permission convention — only mutations require manage_staff,
// and only mutations get the sensitive rate limiter below).
router.get('/', authenticate, validate(listStaffSchema), staffController.list);
router.post(
  '/',
  sensitiveRateLimiter,
  authenticate,
  requirePermission('manage_staff'),
  validate(createStaffSchema),
  staffController.create,
);
router.get('/:staffId', authenticate, validate(staffIdOnlySchema), staffController.get);
router.put(
  '/:staffId',
  sensitiveRateLimiter,
  authenticate,
  requirePermission('manage_staff'),
  validate(updateStaffSchema),
  staffController.update,
);
router.delete(
  '/:staffId',
  sensitiveRateLimiter,
  authenticate,
  requirePermission('manage_staff'),
  validate(staffIdOnlySchema),
  staffController.remove,
);

export default router;

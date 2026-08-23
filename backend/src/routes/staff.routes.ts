import { Router } from 'express';
import * as staffController from '../controllers/staff.controller';
import { authenticate } from '../middleware/authenticate';
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
// Phase 2 read-permission convention — only mutations require manage_staff).
router.get('/', authenticate, validate(listStaffSchema), staffController.list);
router.post(
  '/',
  authenticate,
  requirePermission('manage_staff'),
  validate(createStaffSchema),
  staffController.create,
);
router.get('/:staffId', authenticate, validate(staffIdOnlySchema), staffController.get);
router.put(
  '/:staffId',
  authenticate,
  requirePermission('manage_staff'),
  validate(updateStaffSchema),
  staffController.update,
);
router.delete(
  '/:staffId',
  authenticate,
  requirePermission('manage_staff'),
  validate(staffIdOnlySchema),
  staffController.remove,
);

export default router;

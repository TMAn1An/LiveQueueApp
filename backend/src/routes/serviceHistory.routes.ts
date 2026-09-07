import { Router } from 'express';
import * as serviceHistoryController from '../controllers/serviceHistory.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { requireVerified } from '../middleware/requireVerified';
import { validate } from '../middleware/validate';
import { listServiceHistorySchema } from '../validators/serviceHistory.validators';

const router = Router();

/**
 * Reuses `view_reports` rather than introducing a new permission: this is a
 * historical record of delivered service, the same class of information the
 * reports page already exposes to the same roles.
 */
router.get(
  '/',
  authenticate,
  requireVerified,
  requirePermission('view_reports'),
  validate(listServiceHistorySchema),
  serviceHistoryController.list,
);

export default router;

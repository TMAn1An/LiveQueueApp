import { Router } from 'express';
import * as auditLogController from '../controllers/auditLog.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import { listAuditLogsSchema } from '../validators/auditLog.validators';

const router = Router();

// Gated by the existing view_reports permission (approved Phase 7 decision
// — no new permission was created for this).
router.get(
  '/',
  authenticate,
  requirePermission('view_reports'),
  validate(listAuditLogsSchema),
  auditLogController.list,
);

export default router;

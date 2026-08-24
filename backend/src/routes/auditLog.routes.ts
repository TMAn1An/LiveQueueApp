import { Router } from 'express';
import * as auditLogController from '../controllers/auditLog.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import { listAuditLogsSchema } from '../validators/auditLog.validators';

const router = Router();

// Dedicated permission (frozen RBAC policy) — deliberately separate from
// view_reports so ACCOUNTANT can have reports without audit-log access.
router.get(
  '/',
  authenticate,
  requirePermission('view_audit_logs'),
  validate(listAuditLogsSchema),
  auditLogController.list,
);

export default router;

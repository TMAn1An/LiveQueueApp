import { Router } from 'express';
import * as reportController from '../controllers/report.controller';
import { authenticate } from '../middleware/authenticate';
import { reportRateLimiter } from '../middleware/rateLimit';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import { exportReportSchema, getReportSchema } from '../validators/report.validators';

const router = Router();

router.get(
  '/',
  reportRateLimiter,
  authenticate,
  requirePermission('view_reports'),
  validate(getReportSchema),
  reportController.getReport,
);
router.get(
  '/export',
  reportRateLimiter,
  authenticate,
  requirePermission('export_reports'),
  validate(exportReportSchema),
  reportController.exportReport,
);

export default router;

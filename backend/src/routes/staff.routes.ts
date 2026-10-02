import { Router } from 'express';
import * as staffController from '../controllers/staff.controller';
import { authenticate } from '../middleware/authenticate';
import { sensitiveRateLimiter } from '../middleware/rateLimit';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import {
  createRemovalRequestSchema,
  createStaffSchema,
  listRemovalRequestsSchema,
  listStaffSchema,
  removalRequestIdOnlySchema,
  reviewRemovalRequestSchema,
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
// ADR-057: membership-removal requests. Registered before '/:staffId' so the
// path is never read as a staff id. Deliberately NOT behind manage_staff:
// a STAFF member must be able to ask to leave. Who may do what is decided in
// membership.service.ts from the caller's role and the target's.
router.get(
  '/removal-requests',
  authenticate,
  validate(listRemovalRequestsSchema),
  staffController.listRemovalRequests,
);
router.post(
  '/removal-requests',
  sensitiveRateLimiter,
  authenticate,
  validate(createRemovalRequestSchema),
  staffController.createRemovalRequest,
);
router.post(
  '/removal-requests/:requestId/approve',
  sensitiveRateLimiter,
  authenticate,
  validate(reviewRemovalRequestSchema),
  staffController.approveRemovalRequest,
);
router.post(
  '/removal-requests/:requestId/reject',
  sensitiveRateLimiter,
  authenticate,
  validate(reviewRemovalRequestSchema),
  staffController.rejectRemovalRequest,
);
router.post(
  '/removal-requests/:requestId/cancel',
  sensitiveRateLimiter,
  authenticate,
  validate(removalRequestIdOnlySchema),
  staffController.cancelRemovalRequest,
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
// ADR-035: re-send an invitation that never arrived. Same permission and
// limiter as any other staff mutation, plus its own cooldown in the service.
router.post(
  '/:staffId/resend-invitation',
  sensitiveRateLimiter,
  authenticate,
  requirePermission('manage_staff'),
  validate(staffIdOnlySchema),
  staffController.resendInvitation,
);
// manage_staff keeps STAFF out entirely; which ADMIN/OWNER may remove whom
// is ADR-057's matrix in membership.service.ts.
router.delete(
  '/:staffId',
  sensitiveRateLimiter,
  authenticate,
  requirePermission('manage_staff'),
  validate(staffIdOnlySchema),
  staffController.remove,
);

export default router;

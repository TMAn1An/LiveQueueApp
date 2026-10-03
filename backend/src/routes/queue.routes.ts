import { Router } from 'express';
import * as queueController from '../controllers/queue.controller';
import * as serviceController from '../controllers/service.controller';
import * as counterController from '../controllers/counter.controller';
import * as formFieldController from '../controllers/formField.controller';
import * as tokenController from '../controllers/token.controller';
import * as queueScheduleController from '../controllers/queueSchedule.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { COUNTER_MANAGEMENT_DENIAL } from '../services/counterAccess.service';
import { requireVerified } from '../middleware/requireVerified';
import { validate } from '../middleware/validate';
import {
  assignQueueAdminSchema,
  createQueueSchema,
  createQueueSessionSchema,
  deleteQueueSchema,
  listQueuesSchema,
  setRecommendedJourneySchema,
  deleteQueueSessionSchema,
  queueIdOnlySchema,
  updateQueueSchema,
  updateQueueSessionSchema,
  updateQueueStatusSchema,
} from '../validators/queue.validators';
import { createServiceSchema } from '../validators/service.validators';
import { createCounterSchema, listCountersSchema } from '../validators/counter.validators';
import { replaceFormFieldsSchema } from '../validators/formField.validators';
import { nextTokenSchema } from '../validators/token.validators';

const router = Router();

// Any authenticated staff member of the organization may read (approved
// Phase 2 decision 1) — only mutations require the specific permission.
router.get('/', authenticate, requireVerified, validate(listQueuesSchema), queueController.list);
// ADR-069: deletion history (registered before '/:queueId').
router.get(
  '/deleted',
  authenticate,
  requireVerified,
  requirePermission('view_audit_logs'),
  validate(listQueuesSchema),
  queueController.listDeleted,
);
router.post(
  '/',
  authenticate,
  requireVerified,
  requirePermission('manage_queues'),
  validate(createQueueSchema),
  queueController.create,
);
router.get('/:queueId', authenticate, requireVerified, validate(queueIdOnlySchema), queueController.get);
router.put(
  '/:queueId',
  authenticate,
  requireVerified,
  requirePermission('manage_queues'),
  validate(updateQueueSchema),
  queueController.update,
);
// ADR-069 D8: the Organization Head, a Manager, or the queue's own Admin —
// always with a reason (checked again in the service, with the scope).
router.delete(
  '/:queueId',
  authenticate,
  requireVerified,
  requirePermission('delete_queues'),
  validate(deleteQueueSchema),
  queueController.remove,
);
// ADR-070: the recommended service order.
router.get(
  '/:queueId/recommended-journey',
  authenticate,
  requireVerified,
  validate(queueIdOnlySchema),
  queueController.getRecommendedJourney,
);
router.put(
  '/:queueId/recommended-journey',
  authenticate,
  requireVerified,
  requirePermission('manage_services'),
  validate(setRecommendedJourneySchema),
  queueController.setRecommendedJourney,
);
// ADR-069 D2: the Organization Head assigns a queue without an Admin.
router.patch(
  '/:queueId/admin',
  authenticate,
  requireVerified,
  requirePermission('manage_admins'),
  validate(assignQueueAdminSchema),
  queueController.assignAdmin,
);
router.patch(
  '/:queueId/status',
  authenticate,
  requireVerified,
  requirePermission('manage_queues'),
  validate(updateQueueStatusSchema),
  queueController.updateStatus,
);

// Services have no dedicated list endpoint — they surface nested in the
// queue response (approved Phase 2 decision 1).
router.post(
  '/:queueId/services',
  authenticate,
  requireVerified,
  requirePermission('manage_services'),
  validate(createServiceSchema),
  serviceController.create,
);

router.get(
  '/:queueId/counters',
  authenticate,
  requireVerified,
  validate(listCountersSchema),
  counterController.list,
);
router.post(
  '/:queueId/counters',
  authenticate,
  requireVerified,
  requirePermission('manage_counters', COUNTER_MANAGEMENT_DENIAL),
  validate(createCounterSchema),
  counterController.create,
);

// Any authenticated staff member may read (Phase 2 decision 1 convention);
// only the replace mutation requires manage_queues.
router.get(
  '/:queueId/form-fields',
  authenticate,
  requireVerified,
  validate(queueIdOnlySchema),
  formFieldController.list,
);
router.put(
  '/:queueId/form-fields',
  authenticate,
  requireVerified,
  requirePermission('manage_queues'),
  validate(replaceFormFieldsSchema),
  formFieldController.replace,
);

// Phase 4: schedule/sessions. Read is any-authenticated-staff (Phase 2
// decision 1 convention, same as counters/form-fields above); only the
// mutations require manage_queues.
router.get(
  '/:queueId/sessions',
  authenticate,
  requireVerified,
  validate(queueIdOnlySchema),
  queueScheduleController.list,
);
router.post(
  '/:queueId/sessions',
  authenticate,
  requireVerified,
  requirePermission('manage_queues'),
  validate(createQueueSessionSchema),
  queueScheduleController.create,
);
router.put(
  '/:queueId/sessions/:sessionId',
  authenticate,
  requireVerified,
  requirePermission('manage_queues'),
  validate(updateQueueSessionSchema),
  queueScheduleController.update,
);
router.delete(
  '/:queueId/sessions/:sessionId',
  authenticate,
  requireVerified,
  requirePermission('manage_queues'),
  validate(deleteQueueSessionSchema),
  queueScheduleController.remove,
);

// Staff selects the counter; the backend auto-selects the oldest eligible
// waiting token (approved Phase 3 decision 3).
router.post(
  '/:queueId/next',
  authenticate,
  requireVerified,
  requirePermission('operate_tokens'),
  validate(nextTokenSchema),
  tokenController.next,
);

export default router;

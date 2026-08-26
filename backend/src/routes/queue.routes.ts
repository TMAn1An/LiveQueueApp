import { Router } from 'express';
import * as queueController from '../controllers/queue.controller';
import * as serviceController from '../controllers/service.controller';
import * as counterController from '../controllers/counter.controller';
import * as formFieldController from '../controllers/formField.controller';
import * as tokenController from '../controllers/token.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { requireVerified } from '../middleware/requireVerified';
import { validate } from '../middleware/validate';
import {
  createQueueSchema,
  queueIdOnlySchema,
  updateQueueSchema,
  updateQueueStatusSchema,
} from '../validators/queue.validators';
import { createServiceSchema } from '../validators/service.validators';
import { createCounterSchema, listCountersSchema } from '../validators/counter.validators';
import { replaceFormFieldsSchema } from '../validators/formField.validators';
import { nextTokenSchema } from '../validators/token.validators';

const router = Router();

// Any authenticated staff member of the organization may read (approved
// Phase 2 decision 1) — only mutations require the specific permission.
router.get('/', authenticate, requireVerified, queueController.list);
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
router.delete(
  '/:queueId',
  authenticate,
  requireVerified,
  requirePermission('manage_queues'),
  validate(queueIdOnlySchema),
  queueController.remove,
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
  requirePermission('manage_counters'),
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

import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { liveQueueTableSchema } from '../validators/dashboard.validators';

const router = Router();

// Read-only summary data; any authenticated staff member of the
// organization may view it (no dedicated dashboard permission in spec 7.4).
router.get('/stats', authenticate, dashboardController.stats);
router.get('/tokens', authenticate, validate(liveQueueTableSchema), dashboardController.liveTokens);

export default router;

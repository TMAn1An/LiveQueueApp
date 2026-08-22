import { Router } from 'express';
import * as deviceController from '../controllers/device.controller';
import { validate } from '../middleware/validate';
import { registerDeviceSchema } from '../validators/device.validators';

const router = Router();

// Public — a customer's device has no staff account (ADR-011).
router.post('/register', validate(registerDeviceSchema), deviceController.register);

export default router;

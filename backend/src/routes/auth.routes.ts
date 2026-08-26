import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { authRateLimiter, sensitiveRateLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from '../validators/auth.validators';

const router = Router();

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.get('/me', authenticate, authController.me);
router.post('/logout', authenticate, validate(logoutSchema), authController.logout);
router.post('/refresh', authRateLimiter, validate(refreshSchema), authController.refresh);
router.patch(
  '/password',
  authenticate,
  sensitiveRateLimiter,
  validate(changePasswordSchema),
  authController.changePassword,
);

export default router;

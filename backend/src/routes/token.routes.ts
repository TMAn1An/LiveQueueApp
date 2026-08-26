import { Router } from 'express';
import * as tokenController from '../controllers/token.controller';
import * as notificationPreferenceController from '../controllers/notificationPreference.controller';
import { authenticate } from '../middleware/authenticate';
import { optionalAuthenticate } from '../middleware/optionalAuthenticate';
import { publicRateLimiter, tokenCreateRateLimiter } from '../middleware/rateLimit';
import { requirePermission } from '../middleware/requirePermission';
import { requireVerified } from '../middleware/requireVerified';
import { validate } from '../middleware/validate';
import { callTokenSchema, createTokenSchema, tokenIdOnlySchema } from '../validators/token.validators';
import { setNotificationPreferenceSchema } from '../validators/notificationPreference.validators';

const router = Router();

// Public — a customer's device has no staff account (ADR-011). Its own
// stricter limiter category, separate from the read-only public endpoints
// below — this is the most business-critical public write in the app.
router.post('/', tokenCreateRateLimiter, validate(createTokenSchema), tokenController.create);

// Staff (own organization) get the full record; anyone else (including an
// anonymous customer) gets the customer-safe view — decided inside the
// service layer, not by branching routes.
router.get(
  '/:tokenId',
  publicRateLimiter,
  optionalAuthenticate,
  validate(tokenIdOnlySchema),
  tokenController.get,
);

// Lightweight polling endpoint — public, minimal payload only.
router.get('/:tokenId/status', publicRateLimiter, validate(tokenIdOnlySchema), tokenController.getStatus);

// Public, same trust model as token creation — Phase 7 Step 7. The device
// must own the token (enforced in the service layer), not just exist.
router.put(
  '/:tokenId/notification-preferences',
  publicRateLimiter,
  validate(setNotificationPreferenceSchema),
  notificationPreferenceController.set,
);

router.post(
  '/:tokenId/call',
  authenticate,
  requireVerified,
  requirePermission('operate_tokens'),
  validate(callTokenSchema),
  tokenController.call,
);
router.post(
  '/:tokenId/start',
  authenticate,
  requireVerified,
  requirePermission('operate_tokens'),
  validate(tokenIdOnlySchema),
  tokenController.start,
);
router.post(
  '/:tokenId/complete',
  authenticate,
  requireVerified,
  requirePermission('operate_tokens'),
  validate(tokenIdOnlySchema),
  tokenController.complete,
);
router.post(
  '/:tokenId/skip',
  authenticate,
  requireVerified,
  requirePermission('operate_tokens'),
  validate(tokenIdOnlySchema),
  tokenController.skip,
);
router.post(
  '/:tokenId/recall',
  authenticate,
  requireVerified,
  requirePermission('operate_tokens'),
  validate(callTokenSchema),
  tokenController.recall,
);

export default router;

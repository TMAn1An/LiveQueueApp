import { Router } from 'express';
import * as tokenController from '../controllers/token.controller';
import * as notificationPreferenceController from '../controllers/notificationPreference.controller';
import { authenticate } from '../middleware/authenticate';
import { optionalAuthenticate } from '../middleware/optionalAuthenticate';
import { publicRateLimiter, sensitiveRateLimiter, tokenCreateRateLimiter } from '../middleware/rateLimit';
import { requirePermission } from '../middleware/requirePermission';
import { requireVerified } from '../middleware/requireVerified';
import { validate } from '../middleware/validate';
import {
  callTokenSchema,
  cancelTokenSchema,
  createTokenSchema,
  reissueVerificationCodeSchema,
  setRequiredDurationSchema,
  startTokenSchema,
  tokenIdOnlySchema,
  verificationCodeQuerySchema,
} from '../validators/token.validators';
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

// V2 Checkpoint 7 (ADR-029) — customer cancellation. Same public trust model
// as notification-preferences above: device ownership is checked in the
// service layer, never assumed from the token id alone.
router.post(
  '/:tokenId/cancel',
  publicRateLimiter,
  validate(cancelTokenSchema),
  tokenController.cancel,
);

// V2 Checkpoint 7 (ADR-029) — the customer's own read/reissue of the current
// service-start verification code. Ownership-checked in the service layer;
// never regenerates on a plain read (getServiceStartVerificationCode).
router.get(
  '/:tokenId/verification-code',
  publicRateLimiter,
  validate(verificationCodeQuerySchema),
  tokenController.getVerificationCode,
);
router.post(
  '/:tokenId/verification-code/reissue',
  publicRateLimiter,
  validate(reissueVerificationCodeSchema),
  tokenController.reissueVerificationCode,
);

router.post(
  '/:tokenId/call',
  authenticate,
  requireVerified,
  requirePermission('operate_tokens'),
  validate(callTokenSchema),
  tokenController.call,
);
// V2 Checkpoint 7 (ADR-029): now requires a verified customer code — see
// startTokenWithOtp. sensitiveRateLimiter added because this is now a
// brute-forceable-by-guessing endpoint (defense-in-depth alongside the
// per-token failed-attempt limit enforced in the service layer).
router.post(
  '/:tokenId/start',
  sensitiveRateLimiter,
  authenticate,
  requireVerified,
  requirePermission('operate_tokens'),
  validate(startTokenSchema),
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
router.patch(
  '/:tokenId/duration',
  authenticate,
  requireVerified,
  requirePermission('operate_tokens'),
  validate(setRequiredDurationSchema),
  tokenController.setRequiredDuration,
);

export default router;

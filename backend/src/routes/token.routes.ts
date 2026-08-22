import { Router } from 'express';
import * as tokenController from '../controllers/token.controller';
import { authenticate } from '../middleware/authenticate';
import { optionalAuthenticate } from '../middleware/optionalAuthenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import { callTokenSchema, createTokenSchema, tokenIdOnlySchema } from '../validators/token.validators';

const router = Router();

// Public — a customer's device has no staff account (ADR-011).
router.post('/', validate(createTokenSchema), tokenController.create);

// Staff (own organization) get the full record; anyone else (including an
// anonymous customer) gets the customer-safe view — decided inside the
// service layer, not by branching routes.
router.get('/:tokenId', optionalAuthenticate, validate(tokenIdOnlySchema), tokenController.get);

// Lightweight polling endpoint — public, minimal payload only.
router.get('/:tokenId/status', validate(tokenIdOnlySchema), tokenController.getStatus);

router.post(
  '/:tokenId/call',
  authenticate,
  requirePermission('operate_tokens'),
  validate(callTokenSchema),
  tokenController.call,
);
router.post(
  '/:tokenId/start',
  authenticate,
  requirePermission('operate_tokens'),
  validate(tokenIdOnlySchema),
  tokenController.start,
);
router.post(
  '/:tokenId/complete',
  authenticate,
  requirePermission('operate_tokens'),
  validate(tokenIdOnlySchema),
  tokenController.complete,
);
router.post(
  '/:tokenId/skip',
  authenticate,
  requirePermission('operate_tokens'),
  validate(tokenIdOnlySchema),
  tokenController.skip,
);

export default router;

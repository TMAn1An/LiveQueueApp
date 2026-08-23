import { Router } from 'express';
import * as organizationController from '../controllers/organization.controller';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/requirePermission';
import { validate } from '../middleware/validate';
import { deleteOrganizationSchema, updateOrganizationSchema } from '../validators/organization.validators';

const router = Router();

// Single-tenant scope: there is no :organizationId param — the authenticated
// staff member's own organization (CLAUDE.md Rule 4) is always the target.
router.get('/me', authenticate, organizationController.get);
router.put(
  '/me',
  authenticate,
  requirePermission('manage_organization'),
  validate(updateOrganizationSchema),
  organizationController.update,
);
router.delete(
  '/me',
  authenticate,
  requirePermission('manage_organization'),
  validate(deleteOrganizationSchema),
  organizationController.remove,
);

export default router;

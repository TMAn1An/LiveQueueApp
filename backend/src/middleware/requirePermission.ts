import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import type { Permission } from '../constants/permissions';

/** Must run after `authenticate`. Enforces permissions server-side (spec section 7.4). */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
      return;
    }
    if (!req.auth.permissions.includes(permission)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      return;
    }
    next();
  };
}

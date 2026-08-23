import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { verifyAccessToken } from '../utils/tokens';
import { prisma } from '../config/prisma';
import type { Permission } from '../constants/permissions';

/**
 * Verifies the JWT access token and loads the current staff + organization
 * state fresh from the database on every request. The staff's organizationId
 * from the database — not any client- or token-supplied value — becomes the
 * tenant scope for every downstream query (CLAUDE.md section 3, Rule 4).
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
    return;
  }

  const token = header.slice('Bearer '.length);

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired.'));
      return;
    }
    next(new AppError(401, 'INVALID_TOKEN', 'Access token is invalid.'));
    return;
  }

  const staff = await prisma.staff.findUnique({
    where: { id: payload.sub },
    include: { organization: true },
  });

  if (!staff || staff.status !== 'ACTIVE') {
    next(new AppError(401, 'UNAUTHENTICATED', 'Account is not active.'));
    return;
  }

  if (staff.organization.status !== 'ACTIVE') {
    next(new AppError(403, 'ORGANIZATION_SUSPENDED', 'Organization is not active.'));
    return;
  }

  req.auth = {
    staffId: staff.id,
    organizationId: staff.organizationId,
    email: staff.email,
    role: staff.role,
    permissions: staff.permissions as Permission[],
  };

  next();
}

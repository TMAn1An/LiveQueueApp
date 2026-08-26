import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { verifyAccessToken } from '../utils/tokens';
import { prisma } from '../config/prisma';
import { getEffectivePermissions } from '../constants/permissions';

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

  // V2 Checkpoint 2 (ADR-024): PENDING_EMAIL_VERIFICATION is deliberately
  // allowed through here — only SUSPENDED is fatal at this layer. A pending
  // staff member still needs /me, /logout, and /email-verification/* to
  // work so the dashboard can show its verification-required state and
  // offer a resend; requireVerified (applied selectively to queue-
  // management routes only) is what actually blocks a pending account from
  // using queue functionality, not this middleware.
  if (!staff || staff.status === 'SUSPENDED') {
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
    status: staff.status,
    // Derived from role, never trusted from the stored `permissions` column
    // (frozen RBAC policy) — see getEffectivePermissions's doc comment.
    permissions: getEffectivePermissions(staff.role),
  };

  next();
}

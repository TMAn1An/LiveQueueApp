import type { NextFunction, Request, Response } from 'express';
import { resolveAuthContext } from '../utils/authContext';

/**
 * Used only by customer-facing token endpoints (GET /api/tokens/:tokenId),
 * which must work for an anonymous customer (no JWT at all) while still
 * recognizing an authenticated staff member so the service layer can decide
 * which view to return. Unlike `authenticate`, a missing or invalid token is
 * never fatal here — it just means the request proceeds as anonymous.
 */
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }

  const auth = await resolveAuthContext(header.slice('Bearer '.length));
  if (auth) {
    req.auth = auth;
  }

  next();
}

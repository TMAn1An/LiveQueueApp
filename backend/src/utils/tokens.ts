import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { StaffRole } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  role: StaffRole;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
}

/**
 * Refresh tokens are opaque, high-entropy random strings rather than JWTs.
 * Only their SHA-256 hash is ever persisted (Session.refreshTokenHash); the
 * raw value is returned to the client exactly once, at issuance/rotation.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

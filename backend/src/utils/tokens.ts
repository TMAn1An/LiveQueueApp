import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { StaffRole } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  role: StaffRole;
  /** Issued-at, in seconds — set by jsonwebtoken on every signed token. */
  iat?: number;
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

/**
 * ADR-060: the one-time value inside an emailed link (email verification,
 * staff invitation). 32 random bytes — the same 256 bits of entropy as a
 * session secret needs — written as base64url, so the link is 43 characters
 * of token instead of 96 hex characters: shorter to copy, less like a wall
 * of noise in an inbox. URL-safe without escaping. Stored the same way as
 * every other secret here: only hashRefreshToken(raw).
 */
export function generateEmailLinkToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { generateRefreshToken, hashRefreshToken } from '../utils/tokens';
import { parseDurationToMs } from '../utils/duration';

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

export async function createSession(staffId: string, meta: SessionMeta = {}) {
  const rawRefreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + parseDurationToMs(env.REFRESH_TOKEN_EXPIRES_IN));

  await prisma.session.create({
    data: {
      staffId,
      refreshTokenHash: hashRefreshToken(rawRefreshToken),
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });

  return { rawRefreshToken };
}

/**
 * Rotates a refresh token: the presented session is revoked and replaced by a
 * new one. Presenting a hash that belongs to an already-revoked session is
 * treated as token reuse (theft indicator) and revokes every active session
 * for that staff member as a precaution.
 */
export async function rotateSession(rawRefreshToken: string, meta: SessionMeta = {}) {
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash } });

  if (!session) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid.');
  }

  if (session.revokedAt) {
    await prisma.session.updateMany({
      where: { staffId: session.staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(
      401,
      'REFRESH_TOKEN_REUSED',
      'This refresh token was already used. All sessions have been revoked for safety.',
    );
  }

  if (session.expiresAt < new Date()) {
    throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token has expired.');
  }

  const rawNewRefreshToken = generateRefreshToken();
  const newExpiresAt = new Date(Date.now() + parseDurationToMs(env.REFRESH_TOKEN_EXPIRES_IN));

  const newSession = await prisma.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: {
        staffId: session.staffId,
        refreshTokenHash: hashRefreshToken(rawNewRefreshToken),
        expiresAt: newExpiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });

    await tx.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedBySessionId: created.id },
    });

    return created;
  });

  return { staffId: newSession.staffId, rawRefreshToken: rawNewRefreshToken };
}

/** Idempotent: revoking an already-revoked or unknown session is not an error. */
export async function revokeSession(rawRefreshToken: string, staffId: string) {
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash } });

  if (!session || session.staffId !== staffId || session.revokedAt) {
    return;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes every active session for a staff member except the one identified
 * by `keepRawRefreshToken` (V2 Checkpoint 1 — self-service password change,
 * ADR-022). Scoped by staffId in the WHERE clause, so this can never touch
 * another staff member's session regardless of what token is passed. If
 * `keepRawRefreshToken` doesn't match any active session for this staffId
 * (e.g. it's already stale), every session ends up revoked — a safe
 * fail-closed outcome, not a security hole.
 */
export async function revokeOtherSessions(staffId: string, keepRawRefreshToken: string) {
  const keepHash = hashRefreshToken(keepRawRefreshToken);
  await prisma.session.updateMany({
    where: { staffId, revokedAt: null, refreshTokenHash: { not: keepHash } },
    data: { revokedAt: new Date() },
  });
}

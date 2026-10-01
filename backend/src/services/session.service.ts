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
 * How long after a rotation the token it replaced may be presented again
 * without that being read as theft (ADR-052).
 *
 * One client can legitimately send the same refresh token twice at almost the
 * same moment: two tabs restoring a session, several requests discovering an
 * expired access token together, a retry after a response was lost on the
 * way back. Requests that leave the client together can still reach the
 * server seconds apart, so "at the same moment" needs a tolerance — and it
 * is kept as short as network delay plausibly requires. A duplicate inside it
 * gets nothing (no tokens); it is merely not punished.
 */
export const REFRESH_REUSE_LEEWAY_MS = 10_000;

/**
 * Rotates a refresh token: the presented session is revoked and replaced by a
 * new one, exactly once.
 *
 * The claim is a single conditional UPDATE (`... WHERE revoked_at IS NULL`),
 * so however many requests present the same token at once, PostgreSQL lets
 * precisely one of them rotate it. Reading the row and revoking it in two
 * steps — as this used to — let simultaneous requests all pass the check and
 * each mint its own successor.
 *
 * A token that is presented when it is already revoked is token reuse — the
 * theft indicator — and revokes every active session for that staff member,
 * with one narrow exception (see `isConcurrentDuplicate`).
 */
export async function rotateSession(rawRefreshToken: string, meta: SessionMeta = {}) {
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash } });

  if (!session) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid.');
  }

  if (session.revokedAt) {
    return rejectRevokedToken(session.id, meta);
  }

  if (session.expiresAt < new Date()) {
    throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token has expired.');
  }

  const rawNewRefreshToken = generateRefreshToken();
  const newExpiresAt = new Date(Date.now() + parseDurationToMs(env.REFRESH_TOKEN_EXPIRES_IN));

  const newSession = await prisma.$transaction(async (tx) => {
    const claimed = await tx.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Another request rotated (or revoked) this session between the read
    // above and this statement. Nothing is created for the one that lost.
    if (claimed.count !== 1) return null;

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
      data: { replacedBySessionId: created.id },
    });

    return created;
  });

  if (!newSession) {
    return rejectRevokedToken(session.id, meta);
  }

  return { staffId: newSession.staffId, rawRefreshToken: rawNewRefreshToken };
}

/**
 * A revoked refresh token was presented. Always throws: either the benign
 * "you were a moment too late" answer, or — in every other case — reuse,
 * after revoking all of the staff member's sessions.
 */
async function rejectRevokedToken(sessionId: string, meta: SessionMeta): Promise<never> {
  // Read again rather than trusting the caller's copy: when this request lost
  // the race, the row now carries the winner's revokedAt and successor.
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid.');
  }

  if (await isConcurrentDuplicate(session, meta)) {
    throw new AppError(
      409,
      'REFRESH_TOKEN_SUPERSEDED',
      'This refresh token was just replaced by a newer one. Use the newest token.',
    );
  }

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

/**
 * Whether a revoked token being presented is the same client's own duplicate
 * rather than a replay. Every condition must hold, and failing any of them
 * falls back to treating it as reuse:
 *
 * - it was revoked by a *rotation* — a token ended by logout, a password
 *   change or an earlier reuse response has no successor and never qualifies;
 * - that rotation happened within `REFRESH_REUSE_LEEWAY_MS`;
 * - the session that replaced it is still active — if the account has been
 *   signed out or revoked since, there is nothing benign left to protect;
 * - it comes from the same user agent as the request that rotated it. This
 *   is a consistency check, not authentication (a user agent can be copied).
 *   The IP address is deliberately not compared: behind a load balancer two
 *   requests from one browser can arrive from different proxy addresses, and
 *   a false mismatch would sign a legitimate user out everywhere.
 *
 * Even when all of this holds, the duplicate is answered with an error and
 * is given no tokens, so replaying a just-rotated token gains nothing.
 */
async function isConcurrentDuplicate(
  session: { revokedAt: Date | null; replacedBySessionId: string | null },
  meta: SessionMeta,
): Promise<boolean> {
  if (!session.revokedAt || !session.replacedBySessionId) return false;
  if (Date.now() - session.revokedAt.getTime() > REFRESH_REUSE_LEEWAY_MS) return false;

  const successor = await prisma.session.findUnique({ where: { id: session.replacedBySessionId } });
  if (!successor || successor.revokedAt) return false;

  return (successor.userAgent ?? null) === (meta.userAgent ?? null);
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

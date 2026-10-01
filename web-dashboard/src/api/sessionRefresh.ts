import { ApiError } from './client';
import { refresh } from './auth.api';

export const REFRESH_TOKEN_STORAGE_KEY = 'livequeue_refresh_token';

/** Shared by every tab of this dashboard (Web Locks are per origin). */
const REFRESH_LOCK_NAME = 'livequeue:session-refresh';

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
}

function readStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
}

/**
 * Runs `task` while holding a lock that every tab of this dashboard shares,
 * so two tabs cannot exchange the same stored refresh token at once: the
 * second waits, then reads the token the first one stored. Browsers without
 * the Web Locks API simply run the task; the backend tolerates the rare
 * duplicate that can then occur (ADR-052).
 */
function withCrossTabLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return task();
  return locks.request(REFRESH_LOCK_NAME, task) as Promise<T>;
}

async function exchange(fallbackToken: string | null): Promise<RefreshedTokens | null> {
  return withCrossTabLock(async () => {
    // Read inside the lock: this is the newest token any tab has stored.
    const presented = readStoredRefreshToken() ?? fallbackToken;
    if (!presented) return null;

    let tokens: RefreshedTokens;
    try {
      ({ data: tokens } = await refresh(presented));
    } catch (err) {
      // "Superseded" means something else rotated this token a moment ago and
      // nothing was revoked. If a newer token has been stored meanwhile, that
      // is the one to use; if not, there is nothing to retry with.
      const newer = readStoredRefreshToken();
      const superseded = err instanceof ApiError && err.code === 'REFRESH_TOKEN_SUPERSEDED';
      if (!superseded || !newer || newer === presented) throw err;
      ({ data: tokens } = await refresh(newer));
    }

    // Stored before the lock is released, so the next tab in line sees it.
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
    return tokens;
  });
}

let inFlight: Promise<RefreshedTokens | null> | null = null;

/**
 * Exchanges the stored refresh token for a new access/refresh pair — at most
 * one exchange at a time, however many callers ask.
 *
 * Refresh tokens rotate and each may be used once: presenting one a second
 * time is how the backend recognises a stolen token, and it answers by
 * revoking every session. So the dashboard must never send the same token
 * twice, and it has several ways of trying to: React StrictMode runs the
 * session-restore effect twice, and when an access token expires every
 * request in flight finds out at the same moment. All of them share the one
 * exchange started here and receive its result.
 *
 * Resolves with the new tokens (already stored), or `null` when there is no
 * refresh token to exchange. Rejects when the backend refuses the token.
 *
 * `fallbackToken` is used only when storage holds none.
 */
export function refreshSession(fallbackToken: string | null = null): Promise<RefreshedTokens | null> {
  if (!inFlight) {
    const started = exchange(fallbackToken).finally(() => {
      if (inFlight === started) inFlight = null;
    });
    inFlight = started;
  }
  return inFlight;
}

import * as authApi from '../api/auth.api';

/**
 * The emailed token is single-use: the backend clears it on success, so a
 * second request with it is refused as "invalid or expired". A reload of this
 * tab, or React remounting the page, must therefore never send it again and
 * turn a real success into a false failure.
 *
 *  - one request per token for the life of the page (remounts share it);
 *  - a success is remembered for this browser session, so a reload shows
 *    success again. Storing the token is harmless — it is already spent.
 */
const verificationRequests = new Map<string, Promise<void>>();
const VERIFIED_TOKENS_KEY = 'livequeue_verified_email_tokens';

function wasVerifiedInThisSession(token: string): boolean {
  try {
    const stored = JSON.parse(sessionStorage.getItem(VERIFIED_TOKENS_KEY) ?? '[]') as unknown;
    return Array.isArray(stored) && stored.includes(token);
  } catch {
    return false;
  }
}

function rememberVerified(token: string): void {
  try {
    const stored = JSON.parse(sessionStorage.getItem(VERIFIED_TOKENS_KEY) ?? '[]') as unknown;
    const tokens = Array.isArray(stored) ? stored.filter((t) => typeof t === 'string') : [];
    sessionStorage.setItem(VERIFIED_TOKENS_KEY, JSON.stringify([...tokens, token].slice(-5)));
  } catch {
    // Storage unavailable (private mode, quota): only the reload case is lost.
  }
}

export function verifyEmailOnce(token: string): Promise<void> {
  if (wasVerifiedInThisSession(token)) return Promise.resolve();
  let request = verificationRequests.get(token);
  if (!request) {
    request = authApi.verifyEmail(token).then(() => rememberVerified(token));
    verificationRequests.set(token, request);
  }
  return request;
}

/** Test-only: forget in-flight requests between tests. */
export function resetVerificationRequestsForTests(): void {
  verificationRequests.clear();
}

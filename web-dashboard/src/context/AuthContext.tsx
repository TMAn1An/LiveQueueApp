import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as authApi from '../api/auth.api';
import { registerAuthHandlers } from '../api/client';
import { REFRESH_TOKEN_STORAGE_KEY, isAuthRejection, refreshSession } from '../api/sessionRefresh';
import { browserTimezone } from '../utils/timezone';
import type { Organization, Permission, Staff } from '../types/auth';

/**
 * How long to wait before each new attempt to reach the backend while a
 * session restore is pending. Short at first — most interruptions are a
 * restart or a brief drop — then spaced out, so a long outage (or a rate
 * limit) is not hammered. The last value repeats.
 */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000];

interface AuthState {
  /**
   * `reconnecting`: there is a stored session, but the backend could not be
   * reached to confirm it. Nothing is assumed either way — the person is
   * neither treated as signed in (no protected screen is shown, no cached
   * identity is used) nor signed out (the stored session is kept). It ends
   * only when the backend answers: with an identity, or with a refusal.
   */
  status: 'loading' | 'authenticated' | 'unauthenticated' | 'reconnecting';
  staff: Staff | null;
  organization: Organization | null;
  permissions: Permission[];
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (organizationName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
  /** Re-reads the signed-in staff member, organization and permissions from
   * the backend — e.g. after the account's email was verified in another
   * tab. Returns the fresh staff record, or null when signed out. */
  refreshIdentity: () => Promise<Staff | null>;
  /** While `reconnecting`: try the backend again now instead of waiting for
   * the next scheduled attempt. Does nothing in any other state. */
  retrySessionRestore: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    staff: null,
    organization: null,
    permissions: [],
  });

  // Refs, not state: the module-level api client handlers close over these
  // and must always read the latest value, not a stale render's snapshot.
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);

  /**
   * Refresh tokens rotate, and presenting an already-used one is treated as
   * theft — every session is revoked. Another tab of this dashboard (the one
   * the emailed verification link opens, typically) rotates the token stored
   * in localStorage, which this tab's in-memory copy never sees. So the
   * shared, most recently rotated value is always preferred.
   */
  function currentRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? refreshTokenRef.current;
  }

  function applyAuthResult(result: {
    staff: Staff;
    organization: Organization;
    permissions: Permission[];
    accessToken: string;
    refreshToken: string;
  }) {
    accessTokenRef.current = result.accessToken;
    refreshTokenRef.current = result.refreshToken;
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, result.refreshToken);
    setState({
      status: 'authenticated',
      staff: result.staff,
      organization: result.organization,
      permissions: result.permissions,
    });
  }

  const clearAuth = useCallback(() => {
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    setState({ status: 'unauthenticated', staff: null, organization: null, permissions: [] });
  }, []);

  useEffect(() => {
    registerAuthHandlers({
      getAccessToken: () => accessTokenRef.current,
      onAuthExpired: () => clearAuth(),
      // Every caller shares one exchange (refreshSession): when an access
      // token expires, all the requests in flight find out together, and
      // each sending the refresh token itself is what used to trip the
      // backend's reuse protection and sign the user out.
      refreshAccessToken: async () => {
        try {
          const tokens = await refreshSession(refreshTokenRef.current);
          if (!tokens) return null;
          accessTokenRef.current = tokens.accessToken;
          refreshTokenRef.current = tokens.refreshToken;
          return tokens.accessToken;
        } catch (err) {
          // Only the backend refusing the session ends it. If the exchange
          // simply could not be made (offline, timeout, server error), the
          // request that needed it fails with that error and the session is
          // left alone for the next request to try again.
          if (!isAuthRejection(err)) throw err;
          clearAuth();
          return null;
        }
      },
    });
  }, [clearAuth]);

  /**
   * Confirms the stored session with the backend: the refresh token is
   * exchanged for a fresh access token, then /me re-reads staff, organization
   * and permissions from the database rather than trusting anything cached.
   *
   * Three outcomes, and only the backend can produce the first two:
   * - it answers with an identity: authenticated;
   * - it refuses (invalid, expired, revoked, suspended): signed out, and the
   *   stored session is discarded;
   * - it cannot be reached: `reconnecting`. The stored session is kept
   *   untouched and nothing is concluded. Being offline is not evidence that
   *   a session is invalid, and treating it as such signed people out every
   *   time the backend restarted.
   */
  const restoreSession = useCallback(async (): Promise<'authenticated' | 'signed-out' | 'unreachable'> => {
    try {
      // A previous attempt may have got as far as new tokens before /me
      // failed; those are still good, so the single-use refresh token is not
      // spent a second time.
      if (!accessTokenRef.current) {
        const tokens = await refreshSession(refreshTokenRef.current);
        if (!tokens) {
          clearAuth();
          return 'signed-out';
        }
        accessTokenRef.current = tokens.accessToken;
        refreshTokenRef.current = tokens.refreshToken;
      }

      const { data: identity } = await authApi.me();
      setState({
        status: 'authenticated',
        staff: identity.staff,
        organization: identity.organization,
        permissions: identity.permissions,
      });
      return 'authenticated';
    } catch (err) {
      if (isAuthRejection(err)) {
        clearAuth();
        return 'signed-out';
      }
      setState((s) => (s.status === 'authenticated' ? s : { ...s, status: 'reconnecting' }));
      return 'unreachable';
    }
  }, [clearAuth]);

  // Silent session restore on load.
  //
  // React StrictMode runs this effect twice in development. Both runs share
  // the one exchange in flight, so the stored token is still sent only once.
  useEffect(() => {
    if (!localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)) {
      setState((s) => ({ ...s, status: 'unauthenticated' }));
      return;
    }
    void restoreSession();
  }, [restoreSession]);

  // While the backend is unreachable, keep trying: on a schedule, and at
  // once when the browser comes back online, the tab becomes visible again,
  // or the person asks.
  //
  // Each attempt first asks the backend whether it is there at all (a plain
  // health check: no credentials, nothing changed). The refresh token is
  // single-use, so it is only sent again once the server is known to answer.
  const retryNowRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (state.status !== 'reconnecting') return;

    let cancelled = false;
    let running = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
      timer = setTimeout(() => void tryNow(), delay);
    };

    const tryNow = async () => {
      if (cancelled || running) return;
      running = true;
      clearTimeout(timer);
      const reachable = await authApi.checkBackendReachable();
      const outcome = reachable && !cancelled ? await restoreSession() : 'unreachable';
      running = false;
      if (cancelled || outcome !== 'unreachable') return;
      attempt += 1;
      schedule();
    };

    const onOnline = () => void tryNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tryNow();
    };

    retryNowRef.current = () => void tryNow();
    schedule();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      retryNowRef.current = () => undefined;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state.status, restoreSession]);

  const retrySessionRestore = useCallback(() => retryNowRef.current(), []);

  // Stable identity, so a consumer can depend on it in an effect without
  // re-subscribing on every render. Reads only refs and storage.
  const refreshIdentity = useCallback(async (): Promise<Staff | null> => {
    if (!accessTokenRef.current && !localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)) return null;
    const { data: identity } = await authApi.me();
    setState({
      status: 'authenticated',
      staff: identity.staff,
      organization: identity.organization,
      permissions: identity.permissions,
    });
    return identity.staff;
  }, []);

  async function login(email: string, password: string) {
    const { data } = await authApi.login({ email, password });
    applyAuthResult(data);
  }

  async function register(organizationName: string, email: string, password: string) {
    // ADR-035: the browser's zone becomes the organization's starting
    // timezone, so queues have a clock without anyone choosing one.
    const { data } = await authApi.register({
      organizationName,
      email,
      password,
      timezone: browserTimezone(),
    });
    applyAuthResult(data);
  }

  async function logout() {
    const latestRefreshToken = currentRefreshToken();
    if (latestRefreshToken) {
      try {
        await authApi.logout(latestRefreshToken);
      } catch {
        // Logout is best-effort client-side regardless of server outcome
        // (an already-expired/invalid refresh token, or no network at all)
        // — none of that may block the user from clearing their local
        // session; the local credentials are cleared unconditionally below.
      }
    }
    clearAuth();
  }

  // Requires the caller's own refresh token, same as logout() — the backend
  // uses it to identify which session to keep alive while revoking every
  // other active session for this staff member (ADR-022).
  async function changePassword(currentPassword: string, newPassword: string) {
    const latestRefreshToken = currentRefreshToken();
    if (!latestRefreshToken) {
      throw new Error('No active session.');
    }
    await authApi.changePassword({ currentPassword, newPassword, refreshToken: latestRefreshToken });
  }

  function hasPermission(permission: Permission): boolean {
    return state.permissions.includes(permission);
  }

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        register,
        logout,
        changePassword,
        hasPermission,
        refreshIdentity,
        retrySessionRestore,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as authApi from '../api/auth.api';
import { registerAuthHandlers } from '../api/client';
import { REFRESH_TOKEN_STORAGE_KEY, refreshSession } from '../api/sessionRefresh';
import { browserTimezone } from '../utils/timezone';
import type { Organization, Permission, Staff } from '../types/auth';

interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
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

  function clearAuth() {
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    setState({ status: 'unauthenticated', staff: null, organization: null, permissions: [] });
  }

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
        } catch {
          clearAuth();
          return null;
        }
      },
    });
  }, []);

  // Silent session restore on load: a stored refresh token gets exchanged
  // for a fresh access token, then /me re-confirms current staff/org/
  // permissions from the database rather than trusting anything cached.
  //
  // React StrictMode runs this effect twice in development. Both runs share
  // the one exchange in flight, so the stored token is still sent only once.
  useEffect(() => {
    if (!localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)) {
      setState((s) => ({ ...s, status: 'unauthenticated' }));
      return;
    }

    (async () => {
      try {
        const tokens = await refreshSession();
        if (!tokens) {
          clearAuth();
          return;
        }
        accessTokenRef.current = tokens.accessToken;
        refreshTokenRef.current = tokens.refreshToken;

        const { data: identity } = await authApi.me();
        setState({
          status: 'authenticated',
          staff: identity.staff,
          organization: identity.organization,
          permissions: identity.permissions,
        });
      } catch {
        clearAuth();
      }
    })();
  }, []);

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
      value={{ ...state, login, register, logout, changePassword, hasPermission, refreshIdentity }}
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

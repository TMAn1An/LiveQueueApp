import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as authApi from '../api/auth.api';
import { registerAuthHandlers } from '../api/client';
import type { Organization, Permission, Staff } from '../types/auth';

const REFRESH_TOKEN_STORAGE_KEY = 'livequeue_refresh_token';

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
  hasPermission: (permission: Permission) => boolean;
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
      refreshAccessToken: async () => {
        const currentRefreshToken = refreshTokenRef.current;
        if (!currentRefreshToken) return null;
        try {
          const { data } = await authApi.refresh(currentRefreshToken);
          accessTokenRef.current = data.accessToken;
          refreshTokenRef.current = data.refreshToken;
          localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, data.refreshToken);
          return data.accessToken;
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
  useEffect(() => {
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    if (!storedRefreshToken) {
      setState((s) => ({ ...s, status: 'unauthenticated' }));
      return;
    }

    (async () => {
      try {
        const { data: tokens } = await authApi.refresh(storedRefreshToken);
        accessTokenRef.current = tokens.accessToken;
        refreshTokenRef.current = tokens.refreshToken;
        localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);

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

  async function login(email: string, password: string) {
    const { data } = await authApi.login({ email, password });
    applyAuthResult(data);
  }

  async function register(organizationName: string, email: string, password: string) {
    const { data } = await authApi.register({ organizationName, email, password });
    applyAuthResult(data);
  }

  async function logout() {
    const currentRefreshToken = refreshTokenRef.current;
    if (currentRefreshToken) {
      try {
        await authApi.logout(currentRefreshToken);
      } catch {
        // Logout is best-effort client-side regardless of server outcome
        // (an already-expired/invalid refresh token, or no network at all)
        // — none of that may block the user from clearing their local
        // session; the local credentials are cleared unconditionally below.
      }
    }
    clearAuth();
  }

  function hasPermission(permission: Permission): boolean {
    return state.permissions.includes(permission);
  }

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

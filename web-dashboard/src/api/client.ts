import type { ApiEnvelope, Pagination } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Auth wiring is registered by AuthContext at app startup (avoids a circular
 * import between the API layer and the context that depends on it — the
 * same "register handlers, module holds a mutable reference" pattern axios
 * interceptors use). Never persisted here: the access token lives only in
 * memory (AuthContext state), reused on each call via this getter.
 */
interface AuthHandlers {
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
  onAuthExpired: () => void;
}

let authHandlers: AuthHandlers | null = null;

export function registerAuthHandlers(handlers: AuthHandlers): void {
  authHandlers = handlers;
}

/** For the socket connection (services/socket.service.ts), which needs the
 * live access token at connect/reconnect time without its own context wiring. */
export function getCurrentAccessToken(): string | null {
  return authHandlers?.getAccessToken() ?? null;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Set for the one internal retry-after-refresh call — prevents infinite refresh loops. */
  _isRetry?: boolean;
}

export interface ApiResult<T> {
  data: T;
  pagination?: Pagination;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const accessToken = authHandlers?.getAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // 204 No Content — nothing to parse.
  if (res.status === 204) {
    return { data: undefined as T };
  }

  const envelope = (await res.json()) as ApiEnvelope<T>;

  if (!envelope.success) {
    // Access token expired mid-session — try one silent refresh-and-retry
    // before surfacing the failure, matching the mobile app's resync
    // philosophy of never assuming a stale credential is fatal on its own.
    if (
      res.status === 401 &&
      envelope.error.code === 'TOKEN_EXPIRED' &&
      !options._isRetry &&
      authHandlers
    ) {
      const newToken = await authHandlers.refreshAccessToken();
      if (newToken) {
        return apiFetch<T>(path, { ...options, _isRetry: true });
      }
    }
    if (res.status === 401) {
      authHandlers?.onAuthExpired();
    }
    throw new ApiError(res.status, envelope.error.code, envelope.error.message);
  }

  return { data: envelope.data, pagination: envelope.pagination };
}

/** For the one endpoint that returns a raw file body (CSV export), not the JSON envelope. */
export async function apiFetchBlob(path: string, query?: RequestOptions['query']): Promise<Blob> {
  const headers: Record<string, string> = {};
  const accessToken = authHandlers?.getAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(buildUrl(path, query), { headers });
  if (!res.ok) {
    throw new ApiError(res.status, 'EXPORT_FAILED', 'Failed to export report.');
  }
  return res.blob();
}

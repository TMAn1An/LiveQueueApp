import type { ApiEnvelope, Pagination } from '../types/api';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1'];
const DEV_API_PORT = 4000;

export const MISSING_API_BASE_URL_MESSAGE =
  'VITE_API_BASE_URL is not set. A built dashboard has no default API address: ' +
  'set VITE_API_BASE_URL to the backend origin when building (see web-dashboard/.env.example).';

export interface ApiBaseUrlInputs {
  /** VITE_API_BASE_URL as baked in at build time. */
  configuredUrl: string | undefined;
  /** True only under the Vite dev server (and the test runner) — never in a build. */
  isDevelopment: boolean;
  /** The hostname the dashboard itself is being served from, when in a browser. */
  pageHostname: string | undefined;
}

/**
 * Where the API lives.
 *
 * A configured URL always wins. Without one, a development server may assume
 * the local backend — but a built dashboard must never do that: quietly
 * pointing production at `localhost` sends every visitor's requests to their
 * own machine. So that case throws instead (and `vite build` refuses to
 * produce such a build in the first place — see vite.config.ts).
 *
 * Loopback addresses are aligned with the page's own (`localhost` vs
 * `127.0.0.1`), because browsers treat the two as different sites.
 */
export function resolveApiBaseUrl({ configuredUrl, isDevelopment, pageHostname }: ApiBaseUrlInputs): string {
  const pageIsLoopback = pageHostname !== undefined && LOOPBACK_HOSTS.includes(pageHostname);
  const envUrl = configuredUrl?.trim();

  if (envUrl) {
    if (pageIsLoopback) {
      try {
        const parsed = new URL(envUrl);
        if (LOOPBACK_HOSTS.includes(parsed.hostname)) {
          parsed.hostname = pageHostname;
          return parsed.origin;
        }
      } catch {
        // Fall back to envUrl
      }
    }
    return envUrl;
  }

  if (!isDevelopment) {
    throw new Error(MISSING_API_BASE_URL_MESSAGE);
  }

  const host = pageHostname === '127.0.0.1' ? '127.0.0.1' : 'localhost';
  return `http://${host}:${DEV_API_PORT}`;
}

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl({
    configuredUrl: import.meta.env.VITE_API_BASE_URL,
    isDevelopment: import.meta.env.DEV,
    pageHostname: typeof window !== 'undefined' ? window.location?.hostname : undefined,
  });
}

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
  /** Lets a caller cancel the request (a timeout, or a newer request
   * superseding this one). */
  signal?: AbortSignal;
}

export interface ApiResult<T> {
  data: T;
  pagination?: Pagination;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${getApiBaseUrl()}${path}`);
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
  // ADR-071: a read (GET/HEAD) carries no Content-Type — with a JSON content
  // type it is not a "simple" request, and the browser would send an extra
  // CORS preflight round trip before each one. Writes keep it as before.
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  if (options.body !== undefined || (method !== 'GET' && method !== 'HEAD')) {
    headers['Content-Type'] = 'application/json';
  }
  const accessToken = authHandlers?.getAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    ...(options.signal ? { signal: options.signal } : {}),
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
      // Several requests usually discover the expiry together. If one of
      // them has already refreshed while this response was on its way back,
      // the token in hand is newer than the one this request was sent with:
      // retry with it rather than rotating the refresh token yet again.
      const currentToken = authHandlers.getAccessToken();
      const alreadyRefreshed = currentToken !== null && currentToken !== accessToken;
      const newToken = alreadyRefreshed ? currentToken : await authHandlers.refreshAccessToken();
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

import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import { apiFetch } from '../api/client';

/**
 * End-to-end regression for the refresh race, with nothing mocked between
 * AuthProvider and the network: the real context, the real API client and the
 * real refresh coordination run against a fake backend.
 *
 * The fake backend is deliberately STRICT — it has no tolerance for a
 * duplicate at all. Any second presentation of a rotated refresh token
 * revokes every session, exactly what used to sign users out. So these tests
 * pass only if the dashboard itself never sends the same token twice.
 */

const REFRESH_TOKEN_KEY = 'livequeue_refresh_token';

const identity = {
  staff: {
    id: 's1',
    organizationId: 'o1',
    name: 'Jane',
    email: 'jane@example.com',
    role: 'OWNER',
    status: 'ACTIVE',
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  },
  organization: { id: 'o1', name: 'Acme', status: 'ACTIVE', timezone: 'UTC', onboardingCompletedAt: '2026-01-01T00:00:00Z' },
  permissions: ['manage_queues'],
};

function createStrictBackend() {
  let counter = 0;
  const liveRefreshTokens = new Set<string>();
  const rotatedRefreshTokens = new Set<string>();
  const liveAccessTokens = new Set<string>();
  const expiredAccessTokens = new Set<string>();
  const log = { refreshCalls: [] as string[], reuseDetections: 0, dataCalls: 0 };
  let reachable = true;
  let loseNextRefreshResponse = false;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const failure = (status: number, code: string) =>
    json(status, { success: false, error: { code, message: code } });
  const latency = () => new Promise((resolve) => setTimeout(resolve, 5));

  function issue() {
    counter += 1;
    const tokens = { accessToken: `access-${counter}`, refreshToken: `refresh-${counter}` };
    liveRefreshTokens.add(tokens.refreshToken);
    liveAccessTokens.add(tokens.accessToken);
    return tokens;
  }

  function revokeEverything() {
    liveRefreshTokens.clear();
    liveAccessTokens.clear();
  }

  function authorize(init?: RequestInit): Response | null {
    const header = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
    const token = header.replace('Bearer ', '');
    if (liveAccessTokens.has(token)) return null;
    return failure(401, expiredAccessTokens.has(token) ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED');
  }

  async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
    await latency();
    // Down means down: nothing is processed and the browser's fetch rejects.
    if (!reachable) throw new TypeError('Failed to fetch');
    if (path === '/health') return json(200, { status: 'ok' });

    if (path === '/api/auth/login') {
      return json(200, { success: true, data: { ...identity, ...issue() } });
    }
    if (path === '/api/auth/refresh') {
      const presented = body.refreshToken ?? '';
      log.refreshCalls.push(presented);
      if (rotatedRefreshTokens.has(presented)) {
        log.reuseDetections += 1;
        revokeEverything();
        return failure(401, 'REFRESH_TOKEN_REUSED');
      }
      if (!liveRefreshTokens.has(presented)) return failure(401, 'INVALID_REFRESH_TOKEN');
      liveRefreshTokens.delete(presented);
      rotatedRefreshTokens.add(presented);
      const issued = issue();
      if (loseNextRefreshResponse) {
        // The server did its part; the answer never arrived.
        loseNextRefreshResponse = false;
        throw new TypeError('Failed to fetch');
      }
      return json(200, { success: true, data: issued });
    }
    const denied = authorize(init);
    if (denied) return denied;
    if (path === '/api/auth/me') return json(200, { success: true, data: identity });
    log.dataCalls += 1;
    return json(200, { success: true, data: { path } });
  }

  return {
    fetch: vi.fn(handle),
    log,
    /** A session that already exists when the page loads. */
    seedSession() {
      return issue().refreshToken;
    },
    /** The backend going away (a restart, an outage, no network) and coming back. */
    setReachable(value: boolean) {
      reachable = value;
    },
    /** The next rotation happens on the server, but its response is lost. */
    loseNextRefreshResponse() {
      loseNextRefreshResponse = true;
    },
    /** The 15-minute access token lifetime running out. */
    expireAccessTokens() {
      for (const token of liveAccessTokens) expiredAccessTokens.add(token);
      liveAccessTokens.clear();
    },
  };
}

function Probe() {
  const { status, staff, login } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="staff-name">{staff?.name ?? ''}</span>
      <button onClick={() => void login('jane@example.com', 'Password123')}>login</button>
    </div>
  );
}

function renderApp() {
  return render(
    <StrictMode>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </StrictMode>,
  );
}

let backend: ReturnType<typeof createStrictBackend>;

beforeEach(() => {
  localStorage.clear();
  backend = createStrictBackend();
  vi.stubGlobal('fetch', backend.fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('session restore under React StrictMode (a full page reload in development)', () => {
  it('exchanges the stored refresh token exactly once and stays signed in', async () => {
    const stored = backend.seedSession();
    localStorage.setItem(REFRESH_TOKEN_KEY, stored);

    renderApp();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('staff-name').textContent).toBe('Jane');
    expect(backend.log.refreshCalls).toEqual([stored]);
    expect(backend.log.reuseDetections).toBe(0);
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).not.toBe(stored);
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).not.toBeNull();
  });

  it('survives reload after reload: one exchange each time, each with the newest token, never a reuse', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, backend.seedSession());

    for (let reload = 0; reload < 6; reload += 1) {
      const expectedToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      const view = renderApp();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

      expect(backend.log.refreshCalls).toHaveLength(reload + 1);
      expect(backend.log.refreshCalls[reload]).toBe(expectedToken);
      view.unmount();
    }

    expect(new Set(backend.log.refreshCalls).size).toBe(6);
    expect(backend.log.reuseDetections).toBe(0);
  });
});

describe('an access token expiring while several requests are in flight (production)', () => {
  it('refreshes once, retries every request, and keeps the user signed in', async () => {
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    await user.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(backend.log.refreshCalls).toEqual([]);

    backend.expireAccessTokens();
    const paths = ['/api/queues', '/api/dashboard/stats', '/api/staff', '/api/reports', '/api/counters', '/api/organizations/me'];
    const results = await Promise.all(paths.map((path) => apiFetch<{ path: string }>(path)));

    expect(results.map((result) => result.data.path)).toEqual(paths);
    expect(backend.log.refreshCalls).toHaveLength(1);
    expect(backend.log.reuseDetections).toBe(0);
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).not.toBeNull();

    // And again at the next expiry: the newest token is presented, once.
    backend.expireAccessTokens();
    await Promise.all(paths.map((path) => apiFetch<{ path: string }>(path)));
    expect(backend.log.refreshCalls).toHaveLength(2);
    expect(new Set(backend.log.refreshCalls).size).toBe(2);
    expect(backend.log.reuseDetections).toBe(0);
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
  });
});

describe('a refresh token the backend genuinely rejects', () => {
  it('still signs the user out and clears the stored token', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'never-issued');

    renderApp();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });
});

describe('the backend is unreachable when the page loads', () => {
  /** The browser reporting that the network is back, which retries at once. */
  const comeBackOnline = () => act(() => void window.dispatchEvent(new Event('online')));

  it('keeps the session, sends nothing it cannot take back, and signs in when the backend returns', async () => {
    const stored = backend.seedSession();
    localStorage.setItem(REFRESH_TOKEN_KEY, stored);
    backend.setReachable(false);

    renderApp();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('reconnecting'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe(stored);
    expect(backend.log.refreshCalls).toEqual([]);

    backend.setReachable(true);
    await comeBackOnline();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('staff-name').textContent).toBe('Jane');
    // The kept token, presented once: no reuse, nothing revoked.
    expect(backend.log.refreshCalls).toEqual([stored]);
    expect(backend.log.reuseDetections).toBe(0);
  });

  it('survives reload after reload during the outage', async () => {
    const stored = backend.seedSession();
    localStorage.setItem(REFRESH_TOKEN_KEY, stored);
    backend.setReachable(false);

    for (let reload = 0; reload < 4; reload += 1) {
      const view = renderApp();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('reconnecting'));
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe(stored);
      view.unmount();
    }

    backend.setReachable(true);
    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(backend.log.refreshCalls).toEqual([stored]);
    expect(backend.log.reuseDetections).toBe(0);
  });

  it('does not show the signed-in app, or call any protected endpoint, while it waits', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, backend.seedSession());
    backend.setReachable(false);

    renderApp();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('reconnecting'));
    expect(screen.getByTestId('staff-name').textContent).toBe('');
    expect(backend.log.dataCalls).toBe(0);
  });

  it('ends the session only when the backend says so: a rotation whose answer was lost is refused on retry', async () => {
    // This backend has no tolerance at all, so the retry is reported as
    // reuse. The real one answers "superseded" inside its 10-second leeway
    // (ADR-052). Either way it is an explicit answer, and that — not the
    // dropped connection before it — is what signs the user out.
    localStorage.setItem(REFRESH_TOKEN_KEY, backend.seedSession());
    backend.loseNextRefreshResponse();

    renderApp();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('reconnecting'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).not.toBeNull();

    await comeBackOnline();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(backend.log.refreshCalls).toHaveLength(2);
  });
});

import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import * as authApi from '../api/auth.api';
import { ApiError, apiFetch } from '../api/client';

vi.mock('../api/auth.api');

/**
 * Restoring a session when the backend cannot be reached.
 *
 * The rule under test: only an answer from the backend ends a session. Not
 * being able to ask is not an answer — the stored session is kept, nothing
 * protected is shown, and the dashboard keeps trying until the backend says
 * yes or no.
 */

const REFRESH_TOKEN_KEY = 'livequeue_refresh_token';

const identity = {
  staff: { id: 's1', organizationId: 'o1', name: 'Jane', email: 'jane@example.com', role: 'OWNER' as const, status: 'ACTIVE' as const, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' },
  organization: { id: 'o1', name: 'Acme', status: 'ACTIVE' as const },
  permissions: ['manage_staff' as const],
};
const rotated = { data: { accessToken: 'fresh-access', refreshToken: 'rotated-refresh' } };

const networkDown = () => new TypeError('Failed to fetch');
const rejected = (status: number, code: string) => new ApiError(status, code, code);

function Probe() {
  const { status, staff, retrySessionRestore, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="staff-name">{staff?.name ?? ''}</span>
      <button onClick={retrySessionRestore}>retry</button>
      <button onClick={() => void logout()}>logout</button>
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

const status = () => screen.getByTestId('status').textContent;
/** The browser reporting that the network is back — an immediate retry. */
const comeBackOnline = () => act(() => void window.dispatchEvent(new Event('online')));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  localStorage.setItem(REFRESH_TOKEN_KEY, 'stored-refresh');
  vi.mocked(authApi.me).mockResolvedValue({ data: identity });
  vi.mocked(authApi.checkBackendReachable).mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the backend is unreachable during the initial session restore', () => {
  it('keeps the stored session and waits, instead of signing out', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(networkDown());

    renderApp();

    await waitFor(() => expect(status()).toBe('reconnecting'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('stored-refresh');
    // Not signed in either: no identity is assumed from anything cached.
    expect(screen.getByTestId('staff-name').textContent).toBe('');
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it.each([
    ['a 503 from the server', new ApiError(503, 'UNAVAILABLE', 'Unavailable.')],
    ['a 500 from the server', new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.')],
    ['being rate limited (429)', new ApiError(429, 'RATE_LIMITED', 'Too many requests.')],
    ['a request that timed out', new DOMException('The operation was aborted.', 'AbortError')],
    ['a gateway page that is not JSON', new SyntaxError('Unexpected token <')],
  ])('treats %s the same way: nothing was learned about the session', async (_label, failure) => {
    vi.mocked(authApi.refresh).mockRejectedValue(failure);

    renderApp();

    await waitFor(() => expect(status()).toBe('reconnecting'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('stored-refresh');
  });

  it('does not send the refresh token again until the backend is known to answer', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(networkDown());
    renderApp();
    await waitFor(() => expect(status()).toBe('reconnecting'));
    const sentSoFar = vi.mocked(authApi.refresh).mock.calls.length;

    // Still down: the health check says so, and that is as far as it goes.
    await comeBackOnline();
    await waitFor(() => expect(authApi.checkBackendReachable).toHaveBeenCalled());

    expect(authApi.refresh).toHaveBeenCalledTimes(sentSoFar);
    expect(status()).toBe('reconnecting');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('stored-refresh');
  });

  it('signs in by itself once the backend is back', async () => {
    vi.mocked(authApi.refresh).mockRejectedValueOnce(networkDown()).mockResolvedValue(rotated);
    renderApp();
    await waitFor(() => expect(status()).toBe('reconnecting'));

    vi.mocked(authApi.checkBackendReachable).mockResolvedValue(true);
    await comeBackOnline();

    await waitFor(() => expect(status()).toBe('authenticated'));
    expect(screen.getByTestId('staff-name').textContent).toBe('Jane');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('rotated-refresh');
    // The token that was kept is the one that was presented.
    expect(vi.mocked(authApi.refresh).mock.calls.at(-1)).toEqual(['stored-refresh']);
  });

  it('“Retry now” tries at once', async () => {
    vi.mocked(authApi.refresh).mockRejectedValueOnce(networkDown()).mockResolvedValue(rotated);
    renderApp();
    await waitFor(() => expect(status()).toBe('reconnecting'));
    vi.mocked(authApi.checkBackendReachable).mockResolvedValue(true);

    await userEvent.setup().click(screen.getByText('retry'));

    await waitFor(() => expect(status()).toBe('authenticated'));
  });

  it('retries on its own schedule too, with nobody touching the page', async () => {
    vi.mocked(authApi.refresh).mockRejectedValueOnce(networkDown()).mockResolvedValue(rotated);
    vi.mocked(authApi.checkBackendReachable).mockResolvedValue(true);

    renderApp();

    await waitFor(() => expect(status()).toBe('reconnecting'));
    // The first scheduled attempt is one second out.
    await waitFor(() => expect(status()).toBe('authenticated'), { timeout: 4_000 });
  });

  it('does not spend the refresh token twice when only the identity request failed', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(rotated);
    vi.mocked(authApi.me).mockRejectedValueOnce(networkDown()).mockRejectedValueOnce(networkDown());
    renderApp();
    await waitFor(() => expect(status()).toBe('reconnecting'));
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('rotated-refresh');

    vi.mocked(authApi.checkBackendReachable).mockResolvedValue(true);
    vi.mocked(authApi.me).mockResolvedValue({ data: identity });
    await comeBackOnline();

    await waitFor(() => expect(status()).toBe('authenticated'));
    expect(authApi.refresh).toHaveBeenCalledTimes(1);
  });

  it('lets the person sign out while waiting, which discards the stored session', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(networkDown());
    vi.mocked(authApi.logout).mockRejectedValue(networkDown());
    renderApp();
    await waitFor(() => expect(status()).toBe('reconnecting'));

    await userEvent.setup().click(screen.getByText('logout'));

    await waitFor(() => expect(status()).toBe('unauthenticated'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });
});

describe('the backend answers, and the answer is no', () => {
  it.each([
    [401, 'INVALID_REFRESH_TOKEN'],
    [401, 'REFRESH_TOKEN_EXPIRED'],
    [401, 'REFRESH_TOKEN_REUSED'],
    [401, 'UNAUTHENTICATED'],
    [409, 'REFRESH_TOKEN_SUPERSEDED'],
  ])('signs out immediately on %i %s', async (httpStatus, code) => {
    vi.mocked(authApi.refresh).mockRejectedValue(rejected(httpStatus, code));

    renderApp();

    await waitFor(() => expect(status()).toBe('unauthenticated'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(authApi.checkBackendReachable).not.toHaveBeenCalled();
  });

  it('signs out when the identity request is refused (a suspended organization is a real 403)', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(rotated);
    vi.mocked(authApi.me).mockRejectedValue(rejected(403, 'ORGANIZATION_SUSPENDED'));

    renderApp();

    await waitFor(() => expect(status()).toBe('unauthenticated'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  it('signs out if the refusal arrives on a later attempt, after the outage', async () => {
    vi.mocked(authApi.refresh)
      .mockRejectedValueOnce(networkDown())
      .mockRejectedValue(rejected(401, 'REFRESH_TOKEN_EXPIRED'));
    renderApp();
    await waitFor(() => expect(status()).toBe('reconnecting'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('stored-refresh');

    vi.mocked(authApi.checkBackendReachable).mockResolvedValue(true);
    await comeBackOnline();

    await waitFor(() => expect(status()).toBe('unauthenticated'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });
});

describe('already signed in, and a token refresh cannot reach the backend', () => {
  const json = (httpStatus: number, body: unknown) =>
    new Response(JSON.stringify(body), { status: httpStatus, headers: { 'Content-Type': 'application/json' } });
  const tokenExpired = () =>
    json(401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } });

  async function signedIn() {
    vi.mocked(authApi.refresh).mockResolvedValueOnce(rotated);
    renderApp();
    await waitFor(() => expect(status()).toBe('authenticated'));
  }

  it('fails that request with the network error and keeps the session', async () => {
    await signedIn();
    vi.stubGlobal('fetch', vi.fn(async () => tokenExpired()));
    vi.mocked(authApi.refresh).mockRejectedValue(networkDown());

    await expect(apiFetch('/api/queues')).rejects.toThrow('Failed to fetch');

    expect(status()).toBe('authenticated');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('rotated-refresh');
  });

  it('recovers on the next request once the backend is back', async () => {
    await signedIn();
    const fetchMock = vi.fn(async () => tokenExpired());
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(authApi.refresh).mockRejectedValueOnce(networkDown());
    await expect(apiFetch('/api/queues')).rejects.toThrow('Failed to fetch');

    vi.mocked(authApi.refresh).mockResolvedValue({ data: { accessToken: 'access-3', refreshToken: 'refresh-3' } });
    fetchMock.mockImplementationOnce(async () => tokenExpired());
    fetchMock.mockImplementationOnce(async () => json(200, { success: true, data: { ok: true } }));

    await expect(apiFetch<{ ok: boolean }>('/api/queues')).resolves.toMatchObject({ data: { ok: true } });
    expect(status()).toBe('authenticated');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-3');
  });

  it('still signs out when the backend refuses the refresh', async () => {
    await signedIn();
    vi.stubGlobal('fetch', vi.fn(async () => tokenExpired()));
    vi.mocked(authApi.refresh).mockRejectedValue(rejected(401, 'REFRESH_TOKEN_REUSED'));

    await expect(apiFetch('/api/queues')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });

    await waitFor(() => expect(status()).toBe('unauthenticated'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  it('does not hide a real 403: it reaches the caller and nobody is signed out for it', async () => {
    await signedIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(403, { success: false, error: { code: 'FORBIDDEN', message: 'Not allowed.' } })),
    );

    await expect(apiFetch('/api/staff')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

    expect(status()).toBe('authenticated');
  });
});

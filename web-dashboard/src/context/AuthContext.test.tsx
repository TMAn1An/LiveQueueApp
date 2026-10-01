import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import * as authApi from '../api/auth.api';

vi.mock('../api/auth.api');

const REFRESH_TOKEN_KEY = 'livequeue_refresh_token';

const authResult = {
  staff: { id: 's1', organizationId: 'o1', name: 'Jane', email: 'jane@example.com', role: 'OWNER' as const, status: 'ACTIVE' as const, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' },
  organization: { id: 'o1', name: 'Acme', status: 'ACTIVE' as const },
  permissions: ['manage_staff' as const],
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
};

function Probe() {
  const { status, staff, hasPermission, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="staff-name">{staff?.name ?? ''}</span>
      <span data-testid="has-manage-staff">{String(hasPermission('manage_staff'))}</span>
      <span data-testid="has-manage-queues">{String(hasPermission('manage_queues'))}</span>
      <button onClick={() => void login('jane@example.com', 'Password123')}>login</button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('AuthProvider — session restore on load', () => {
  it('becomes unauthenticated when no refresh token is stored', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(authApi.refresh).not.toHaveBeenCalled();
  });

  it('restores an authenticated session from a stored refresh token', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'stored-refresh');
    vi.mocked(authApi.refresh).mockResolvedValue({
      data: { accessToken: 'fresh-access', refreshToken: 'rotated-refresh' },
    });
    vi.mocked(authApi.me).mockResolvedValue({
      data: { staff: authResult.staff, organization: authResult.organization, permissions: authResult.permissions },
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('staff-name').textContent).toBe('Jane');
    expect(authApi.refresh).toHaveBeenCalledWith('stored-refresh');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('rotated-refresh');
  });

  it('clears storage and becomes unauthenticated when the stored refresh token is rejected', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'stale-refresh');
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('invalid'));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });
});

describe('AuthProvider — login/logout', () => {
  it('login() populates staff/org/permissions and persists the refresh token', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ data: authResult });
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    await user.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('staff-name').textContent).toBe('Jane');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-1');
  });

  it('hasPermission() reflects only the permissions granted at login', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ data: authResult });
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    await user.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    expect(screen.getByTestId('has-manage-staff').textContent).toBe('true');
    expect(screen.getByTestId('has-manage-queues').textContent).toBe('false');
  });

  it('logout() clears state and storage even if the server call fails', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ data: authResult });
    vi.mocked(authApi.logout).mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    await user.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    await user.click(screen.getByText('logout'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });
});

describe('AuthProvider — email verification and other tabs', () => {
  function IdentityProbe() {
    const { staff, login, logout, refreshIdentity } = useAuth();
    return (
      <div>
        <span data-testid="staff-status">{staff?.status ?? ''}</span>
        <button onClick={() => void login('jane@example.com', 'Password123')}>login</button>
        <button onClick={() => void logout()}>logout</button>
        <button onClick={() => void refreshIdentity()}>refresh identity</button>
      </div>
    );
  }

  it('refreshIdentity() re-reads the account, so a newly verified owner is seen as ACTIVE', async () => {
    const pending = { ...authResult, staff: { ...authResult.staff, status: 'PENDING_EMAIL_VERIFICATION' as const } };
    vi.mocked(authApi.login).mockResolvedValue({ data: pending });
    vi.mocked(authApi.me).mockResolvedValue({
      data: { staff: authResult.staff, organization: authResult.organization, permissions: authResult.permissions },
    });
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <IdentityProbe />
      </AuthProvider>,
    );

    await user.click(screen.getByText('login'));
    await waitFor(() =>
      expect(screen.getByTestId('staff-status').textContent).toBe('PENDING_EMAIL_VERIFICATION'),
    );

    await user.click(screen.getByText('refresh identity'));
    await waitFor(() => expect(screen.getByTestId('staff-status').textContent).toBe('ACTIVE'));
  });

  it('uses the refresh token another tab rotated, never a stale in-memory one (reuse revokes every session)', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ data: authResult });
    vi.mocked(authApi.logout).mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <IdentityProbe />
      </AuthProvider>,
    );
    await user.click(screen.getByText('login'));
    await waitFor(() => expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-1'));

    // The verification link opened in another tab, which restored the
    // session and rotated the shared token.
    localStorage.setItem(REFRESH_TOKEN_KEY, 'rotated-by-other-tab');
    await user.click(screen.getByText('logout'));

    expect(authApi.logout).toHaveBeenCalledWith('rotated-by-other-tab');
  });
});

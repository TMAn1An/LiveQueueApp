import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VerifyEmailPage, VERIFIED_REDIRECT_DELAY_MS } from './VerifyEmailPage';
import { resetVerificationRequestsForTests } from '../utils/verifyEmailOnce';
import * as authApi from '../api/auth.api';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import * as sync from '../utils/emailVerificationSync';

vi.mock('../api/auth.api');
vi.mock('../context/AuthContext');

const refreshIdentity = vi.fn();

function mockAuth(status: 'loading' | 'authenticated' | 'unauthenticated') {
  vi.mocked(useAuth).mockReturnValue({ status, refreshIdentity } as unknown as ReturnType<typeof useAuth>);
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/dashboard" element={<p>DASHBOARD PAGE</p>} />
        <Route path="/login" element={<p>LOGIN PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const REDIRECT_WAIT = { timeout: VERIFIED_REDIRECT_DELAY_MS + 2000 };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetVerificationRequestsForTests();
  refreshIdentity.mockResolvedValue({ status: 'ACTIVE' });
  vi.mocked(authApi.verifyEmail).mockResolvedValue({ data: { verified: true } } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VerifyEmailPage', () => {
  it('tells other open tabs, then takes a signed-in owner to the dashboard by itself', async () => {
    const announce = vi.spyOn(sync, 'announceEmailVerified');
    mockAuth('authenticated');
    renderAt('/verify-email?token=abc');

    expect(await screen.findByText(/Your email has been verified/)).toBeInTheDocument();
    expect(screen.getByText('Taking you to your dashboard…')).toBeInTheDocument();
    expect(announce).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('DASHBOARD PAGE', undefined, REDIRECT_WAIT)).toBeInTheDocument();
    expect(refreshIdentity).toHaveBeenCalled();
  });

  it('takes a browser that is not signed in to sign-in instead', async () => {
    mockAuth('unauthenticated');
    renderAt('/verify-email?token=abc');

    expect(await screen.findByText('Taking you to sign in…')).toBeInTheDocument();
    expect(await screen.findByText('LOGIN PAGE', undefined, REDIRECT_WAIT)).toBeInTheDocument();
    expect(refreshIdentity).not.toHaveBeenCalled();
  });

  it('shows the backend reason and stays put when the link is invalid or expired', async () => {
    const announce = vi.spyOn(sync, 'announceEmailVerified');
    mockAuth('authenticated');
    vi.mocked(authApi.verifyEmail).mockRejectedValue(
      new ApiError(400, 'VERIFICATION_TOKEN_INVALID', 'This verification link has expired.'),
    );
    renderAt('/verify-email?token=old');

    expect(await screen.findByText('This verification link has expired.')).toBeInTheDocument();
    expect(announce).not.toHaveBeenCalled();
    expect(screen.queryByText(/Taking you/)).not.toBeInTheDocument();
  });

  it('a reload after success shows success again instead of a false "expired" error', async () => {
    mockAuth('unauthenticated');
    const first = renderAt('/verify-email?token=once');
    expect(await screen.findByText(/Your email has been verified/)).toBeInTheDocument();
    first.unmount();

    // A full reload: the module-level request is gone, only the browser
    // session remembers — and the spent token would now be refused.
    resetVerificationRequestsForTests();
    vi.mocked(authApi.verifyEmail).mockRejectedValue(
      new ApiError(400, 'VERIFICATION_TOKEN_INVALID', 'This verification link is invalid or has expired.'),
    );
    renderAt('/verify-email?token=once');

    expect(await screen.findByText(/Your email has been verified/)).toBeInTheDocument();
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(1);
  });

  it('never sends the single-use token twice when the page is mounted twice', async () => {
    mockAuth('unauthenticated');
    renderAt('/verify-email?token=shared');
    renderAt('/verify-email?token=shared');

    await vi.waitFor(() => expect(screen.getAllByText(/Your email has been verified/)).toHaveLength(2));
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(1);
  });

  it('explains a link with no token without calling the backend', () => {
    mockAuth('unauthenticated');
    renderAt('/verify-email');

    expect(screen.getByText('This verification link is missing its token.')).toBeInTheDocument();
    expect(authApi.verifyEmail).not.toHaveBeenCalled();
  });
});

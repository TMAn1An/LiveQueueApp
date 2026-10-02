import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ForgotPasswordPage, GENERIC_RESET_MESSAGE } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { LoginPage } from './LoginPage';
import * as authApi from '../api/auth.api';
import { ApiError } from '../api/client';

vi.mock('../api/auth.api');
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ login: vi.fn() }) }));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ADR-058 — Forgot password', () => {
  it('the login page links to it', async () => {
    renderAt('/login');
    await userEvent.click(screen.getByRole('link', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('always shows the same generic confirmation, never whether an account exists', async () => {
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue({
      data: { message: 'anything the server says' },
    } as Awaited<ReturnType<typeof authApi.requestPasswordReset>>);
    renderAt('/forgot-password');
    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(authApi.requestPasswordReset).toHaveBeenCalledWith('someone@example.com');
    expect(await screen.findByRole('status')).toHaveTextContent(GENERIC_RESET_MESSAGE);
    expect(screen.queryByText('anything the server says')).not.toBeInTheDocument();
  });

  it('reports the rate limit or an unreachable server as an error', async () => {
    vi.mocked(authApi.requestPasswordReset).mockRejectedValue(
      new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'),
    );
    renderAt('/forgot-password');
    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Too many requests. Please try again later.')).toBeInTheDocument();
  });
});

describe('ADR-058 — Reset password', () => {
  function validLink() {
    vi.mocked(authApi.validatePasswordResetToken).mockResolvedValue({
      data: { valid: true },
    } as Awaited<ReturnType<typeof authApi.validatePasswordResetToken>>);
  }

  it('a link with no token goes straight to "request a new link"', () => {
    renderAt('/reset-password');
    expect(screen.getByRole('heading', { name: /can't be used/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('an expired or used link says so before anyone types, with a way to get a new one', async () => {
    vi.mocked(authApi.validatePasswordResetToken).mockResolvedValue({
      data: { valid: false },
    } as Awaited<ReturnType<typeof authApi.validatePasswordResetToken>>);
    renderAt('/reset-password?token=abc');
    expect(await screen.findByRole('heading', { name: /can't be used/ })).toBeInTheDocument();
    expect(authApi.validatePasswordResetToken).toHaveBeenCalledWith('abc');
  });

  it('enforces the password policy and the confirmation as they are typed', async () => {
    validLink();
    renderAt('/reset-password?token=abc');
    const password = await screen.findByLabelText('New password');
    await userEvent.type(password, 'short');
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    await userEvent.clear(password);
    await userEvent.type(password, 'longenough');
    expect(screen.getByText('Include at least one number.')).toBeInTheDocument();
    await userEvent.clear(password);
    await userEvent.type(password, 'GoodPass123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'GoodPass124');
    expect(screen.getByText('These do not match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeDisabled();
  });

  it('resets, then tells them they are signed out everywhere and must sign in', async () => {
    validLink();
    vi.mocked(authApi.resetPassword).mockResolvedValue({
      data: { reset: true },
    } as Awaited<ReturnType<typeof authApi.resetPassword>>);
    renderAt('/reset-password?token=abc');
    await userEvent.type(await screen.findByLabelText('New password'), 'GoodPass123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'GoodPass123');
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(authApi.resetPassword).toHaveBeenCalledWith('abc', 'GoodPass123');
    expect(await screen.findByRole('status')).toHaveTextContent(/signed out on every device/);
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('a link that turns out to be spent on submit switches to the invalid-link view', async () => {
    validLink();
    vi.mocked(authApi.resetPassword).mockRejectedValue(
      new ApiError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This reset link is invalid.'),
    );
    renderAt('/reset-password?token=abc');
    await userEvent.type(await screen.findByLabelText('New password'), 'GoodPass123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'GoodPass123');
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });
});

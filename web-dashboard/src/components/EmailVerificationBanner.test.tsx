import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmailVerificationBanner, VERIFICATION_RECHECK_MS } from './EmailVerificationBanner';
import { useAuth } from '../context/AuthContext';
import { announceEmailVerified } from '../utils/emailVerificationSync';

vi.mock('../context/AuthContext');
vi.mock('../api/auth.api');

const refreshIdentity = vi.fn();

function renderBanner(queryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <EmailVerificationBanner email="owner@example.com" />
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshIdentity.mockResolvedValue({ status: 'PENDING_EMAIL_VERIFICATION' });
  vi.mocked(useAuth).mockReturnValue({ refreshIdentity } as unknown as ReturnType<typeof useAuth>);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EmailVerificationBanner — updates by itself once the link is opened', () => {
  it('tells the owner the page will update on its own', () => {
    renderBanner();
    expect(screen.getByText(/This page will update by itself/)).toBeInTheDocument();
  });

  it('re-checks immediately when another tab reports the email was verified', async () => {
    renderBanner();

    announceEmailVerified();

    await vi.waitFor(() => expect(refreshIdentity).toHaveBeenCalledTimes(1));
  });

  it('re-checks when the owner comes back to this tab', () => {
    renderBanner();

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(refreshIdentity).toHaveBeenCalledTimes(1);
  });

  it('re-checks on its own every interval, for a link opened in another browser or device', () => {
    vi.useFakeTimers();
    renderBanner();

    act(() => {
      vi.advanceTimersByTime(VERIFICATION_RECHECK_MS);
    });

    expect(refreshIdentity).toHaveBeenCalledTimes(1);
  });

  it('refetches every page query once the account is verified', async () => {
    refreshIdentity.mockResolvedValue({ status: 'ACTIVE' });
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderBanner(queryClient);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it('does not refetch while the account is still pending', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderBanner(queryClient);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await vi.waitFor(() => expect(refreshIdentity).toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalled();
  });
});

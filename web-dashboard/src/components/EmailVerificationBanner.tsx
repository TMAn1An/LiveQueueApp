import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as authApi from '../api/auth.api';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { onEmailVerifiedElsewhere } from '../utils/emailVerificationSync';

/** How often a tab left open on the banner re-checks on its own — the
 * fallback for when the link was opened in another browser or on a phone,
 * where no cross-tab signal can reach this tab. */
export const VERIFICATION_RECHECK_MS = 15_000;

/**
 * V2 Checkpoint 2 (ADR-024). Shown across every authenticated page
 * (AppLayout, above the routed <Outlet/>) while the signed-in staff member
 * is PENDING_EMAIL_VERIFICATION — the backend (requireVerified) is the real
 * enforcement boundary, this is purely an informative, always-visible cue
 * plus a resend action, not a redesign of the dashboard's per-page error
 * handling.
 *
 * While it is shown it keeps re-checking the account with the backend, so
 * the page updates by itself once the emailed link is clicked: immediately
 * when the link is opened in another tab of this browser, as soon as this
 * tab is looked at again, and otherwise within VERIFICATION_RECHECK_MS.
 * Verified, AppLayout stops rendering the banner and the page's data is
 * refetched.
 */
export function EmailVerificationBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { refreshIdentity } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    const recheck = () => {
      refreshIdentity()
        .then((staff) => {
          // The pages behind this banner were refused by the backend while
          // the account was pending (requireVerified), so every cached query
          // is refetched and the page fills in without a manual reload.
          // Deliberately not tied to this component still being mounted:
          // AppLayout stops rendering the banner as soon as the status flips.
          if (staff && staff.status !== 'PENDING_EMAIL_VERIFICATION') {
            void queryClient.invalidateQueries();
          }
        })
        // A failed check is simply retried on the next trigger; the banner
        // stays up, which is the truthful state while it cannot confirm.
        .catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck();
    };

    const unsubscribe = onEmailVerifiedElsewhere(recheck);
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(recheck, VERIFICATION_RECHECK_MS);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [refreshIdentity, queryClient]);

  async function handleResend() {
    setState('sending');
    setErrorMessage(null);
    try {
      await authApi.resendVerificationEmail();
      setState('sent');
    } catch (err) {
      // A cooldown or rate limit says how long to wait; anything else keeps
      // the generic message.
      if (err instanceof ApiError && err.status === 429) setErrorMessage(err.message);
      setState('error');
    }
  }

  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p className="font-medium">Verify your email address</p>
      <p className="mt-1">
        We sent a verification link to <span className="font-medium">{email}</span>. You can&apos;t create
        or manage queues until your email is verified. This page will update by itself once you
        open the link.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={state === 'sending'}
          className="font-medium text-amber-900 underline hover:no-underline disabled:opacity-50"
        >
          {state === 'sending' ? 'Sending…' : 'Resend verification email'}
        </button>
        {state === 'sent' && <span className="text-green-700">Sent — check your inbox.</span>}
        {state === 'error' && (
          <span className="text-red-700">{errorMessage ?? 'Failed to send. Please try again shortly.'}</span>
        )}
      </div>
    </div>
  );
}

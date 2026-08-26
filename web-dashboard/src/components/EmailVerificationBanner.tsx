import { useState } from 'react';
import * as authApi from '../api/auth.api';

/**
 * V2 Checkpoint 2 (ADR-024). Shown across every authenticated page
 * (AppLayout, above the routed <Outlet/>) while the signed-in staff member
 * is PENDING_EMAIL_VERIFICATION — the backend (requireVerified) is the real
 * enforcement boundary, this is purely an informative, always-visible cue
 * plus a resend action, not a redesign of the dashboard's per-page error
 * handling.
 */
export function EmailVerificationBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleResend() {
    setState('sending');
    try {
      await authApi.resendVerificationEmail();
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p className="font-medium">Verify your email address</p>
      <p className="mt-1">
        We sent a verification link to <span className="font-medium">{email}</span>. You can&apos;t create
        or manage queues until your email is verified.
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
        {state === 'error' && <span className="text-red-700">Failed to send. Please try again shortly.</span>}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { announceEmailVerified } from '../utils/emailVerificationSync';
import { verifyEmailOnce } from '../utils/verifyEmailOnce';

/** Long enough to read "verified", short enough not to feel stuck. */
export const VERIFIED_REDIRECT_DELAY_MS = 2_000;

/**
 * V2 Checkpoint 2 (ADR-024). The link emailed to the customer points here
 * (`${APP_BASE_URL}/verify-email?token=...`) rather than directly at the
 * backend — this page's only job is to call the real, backend-authoritative
 * verify endpoint on load and show the result; it never marks anything
 * verified itself. Works whether or not the browser opening the link is
 * signed in, since the backend endpoint is public/token-based.
 *
 * On success it tells any other open dashboard tab (usually the one still
 * showing "Verify your email address"), then moves on by itself: to the
 * dashboard when this browser is signed in, otherwise to sign-in.
 */
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>(
    token ? 'verifying' : 'error',
  );
  const [error, setError] = useState<string | null>(
    token ? null : 'This verification link is missing its token.',
  );
  const attempted = useRef(false);
  const navigate = useNavigate();
  const { status: authStatus, refreshIdentity } = useAuth();
  // `reconnecting` still has a session — the dashboard route shows the
  // reconnecting screen and carries on from there; only a tab with no session
  // at all goes to sign-in.
  const destination = authStatus === 'unauthenticated' ? '/login' : '/dashboard';

  useEffect(() => {
    if (attempted.current || !token) return;
    attempted.current = true;

    (async () => {
      try {
        await verifyEmailOnce(token);
        announceEmailVerified();
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    })();
  }, [token]);

  // Waits for this tab's own session restore to settle, so a signed-in owner
  // lands on the dashboard already verified rather than on stale state.
  useEffect(() => {
    if (status !== 'success' || authStatus === 'loading') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (authStatus === 'authenticated') {
          await refreshIdentity().catch(() => undefined);
        }
        if (!cancelled) navigate(destination, { replace: true });
      })();
    }, VERIFIED_REDIRECT_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [status, authStatus, destination, navigate, refreshIdentity]);

  return (
    <div className="text-center">
      {status === 'verifying' && <p className="text-sm text-muted">Verifying your email…</p>}
      {status === 'success' && (
        <>
          <p className="mb-2 text-sm font-medium text-green-700">
            Your email has been verified. You can now use LiveQueue.
          </p>
          <p className="mb-4 text-sm text-muted">
            {destination === '/dashboard' ? 'Taking you to your dashboard…' : 'Taking you to sign in…'}
          </p>
          <Link to={destination} className="font-medium text-brand-600 hover:underline">
            {destination === '/dashboard' ? 'Go to dashboard now' : 'Sign in now'}
          </Link>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="mb-4 text-sm text-red-700">{error}</p>
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </>
      )}
    </div>
  );
}

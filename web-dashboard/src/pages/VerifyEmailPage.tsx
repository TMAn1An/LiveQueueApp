import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as authApi from '../api/auth.api';
import { ApiError } from '../api/client';

/**
 * V2 Checkpoint 2 (ADR-024). The link emailed to the customer points here
 * (`${APP_BASE_URL}/verify-email?token=...`) rather than directly at the
 * backend — this page's only job is to call the real, backend-authoritative
 * verify endpoint on load and show the result; it never marks anything
 * verified itself. Works whether or not the browser opening the link is
 * signed in, since the backend endpoint is public/token-based.
 */
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setStatus('error');
      setError('This verification link is missing its token.');
      return;
    }

    (async () => {
      try {
        await authApi.verifyEmail(token);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    })();
  }, [token]);

  return (
    <div className="text-center">
      {status === 'verifying' && <p className="text-sm text-slate-600">Verifying your email…</p>}
      {status === 'success' && (
        <>
          <p className="mb-4 text-sm font-medium text-green-700">
            Your email has been verified. You can now use LiveQueue.
          </p>
          <Link to="/dashboard" className="font-medium text-blue-600 hover:underline">
            Go to dashboard
          </Link>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="mb-4 text-sm text-red-700">{error}</p>
          <Link to="/login" className="font-medium text-blue-600 hover:underline">
            Back to sign in
          </Link>
        </>
      )}
    </div>
  );
}

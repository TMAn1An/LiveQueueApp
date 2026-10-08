import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { requestPasswordReset } from '../api/auth.api';
import { ApiError } from '../api/client';
import { useBackendWarmup } from '../hooks/useBackendWarmup';

/** ADR-058: the generic answer, shown whatever the backend found. */
export const GENERIC_RESET_MESSAGE =
  'If an account exists for this email, a reset link has been sent.';

/**
 * "Forgot password?" — ADR-058. The page shows the same confirmation for
 * every address, so it never says whether an account exists; only a failure
 * to reach the server (or the rate limit) is reported as an error.
 */
export function ForgotPasswordPage() {
  useBackendWarmup();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <>
        <h1 className="mb-2 text-lg font-semibold text-fg">Check your email</h1>
        <p role="status" className="mb-4 text-sm text-fg-soft">
          {GENERIC_RESET_MESSAGE} The link works once and expires in 30 minutes.
        </p>
        <Link to="/login" className="text-sm font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1 className="mb-1 text-lg font-semibold text-fg">Reset your password</h1>
      <p className="mb-4 text-sm text-muted">
        Enter the email you sign in with and we&apos;ll send you a link to choose a new password.
      </p>
      <ErrorBanner message={error} />
      <div className="mb-4">
        <label htmlFor="forgot-email" className="mb-1 block text-sm font-medium text-fg-soft">
          Email
        </label>
        <input
          id="forgot-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-border-strong px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" loading={submitting} className="w-full">
        {submitting ? 'Sending…' : 'Send reset link'}
      </Button>
      <p className="mt-4 text-center text-sm text-muted">
        Remembered it?{' '}
        <Link to="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

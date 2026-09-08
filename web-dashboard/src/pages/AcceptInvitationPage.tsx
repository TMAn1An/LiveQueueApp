import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PasswordInput } from '../components/PasswordInput';
import { acceptInvitation } from '../api/auth.api';
import { ApiError } from '../api/client';

/**
 * Where an invited colleague lands from their email (ADR-035).
 *
 * The link is the only credential, and it is spent here: they choose a
 * password and then sign in normally. Deliberately does not create a session
 * — a link that has been sitting in an inbox for days should not itself log
 * anyone in.
 *
 * Rendered inside `AuthLayout`, which owns the centred column, the card and
 * the single LiveQueue lockup. This page therefore renders none of those
 * itself; doing so is what once stacked a second logo above a second card.
 */
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await acceptInvitation(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not set up your account. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <>
        <h1 className="mb-2 text-lg font-semibold text-fg">This link is incomplete</h1>
        <p className="text-sm text-fg-soft">
          Open the link from your invitation email again, or ask an administrator to send a new one.
        </p>
      </>
    );
  }

  if (done) {
    return (
      <>
        <h1 className="mb-2 text-lg font-semibold text-fg">Your account is ready</h1>
        <p className="mb-4 text-sm text-fg-soft">
          Sign in with your email address and the password you just chose.
        </p>
        <Button onClick={() => navigate('/login', { replace: true })}>Go to sign in</Button>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-fg">Set up your account</h1>
      <p className="mb-4 text-sm text-muted">
        Choose a password. Nobody else will know it — not even the administrator who invited you.
      </p>
      <ErrorBanner message={error} />
      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted" htmlFor="invite-password">
          New password
        </label>
        <PasswordInput
          id="invite-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-2 py-1.5 text-sm"
        />
        {tooShort && <p className="mt-1 text-xs text-red-600">Use at least 8 characters.</p>}
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs text-muted" htmlFor="invite-confirm">
          Confirm password
        </label>
        <PasswordInput
          id="invite-confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="px-2 py-1.5 text-sm"
        />
        {mismatch && <p className="mt-1 text-xs text-red-600">These do not match.</p>}
      </div>
      <Button
        loading={submitting}
        disabled={submitting || password.length < 8 || password !== confirm}
        onClick={() => void handleSubmit()}
      >
        {submitting ? 'Setting up…' : 'Set password'}
      </Button>
      <p className="mt-4 text-xs text-faint">
        Already set up? <Link to="/login" className="text-brand-600 hover:underline">Sign in</Link>
      </p>
    </>
  );
}

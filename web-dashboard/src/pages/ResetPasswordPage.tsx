import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, ButtonLink } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { FieldError } from '../components/FieldError';
import { PasswordInput } from '../components/PasswordInput';
import { Spinner } from '../components/Spinner';
import { resetPassword, validatePasswordResetToken } from '../api/auth.api';
import { ApiError } from '../api/client';
import { passwordPolicyError } from '../utils/passwordPolicy';

function InvalidLink() {
  return (
    <>
      <h1 className="mb-2 text-lg font-semibold text-fg">This reset link can&apos;t be used</h1>
      <p className="mb-4 text-sm text-fg-soft">
        It may have expired, already been used, or been replaced by a newer link. Reset links work
        once and expire after 30 minutes.
      </p>
      <ButtonLink to="/forgot-password">Request a new link</ButtonLink>
    </>
  );
}

/**
 * Where a "forgot password" email lands (ADR-058). The link is checked
 * before anyone types, spent on submit, and never signs anyone in: every
 * session for the account ends, and the person signs in afresh.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [linkState, setLinkState] = useState<'checking' | 'valid' | 'invalid'>(
    token ? 'checking' : 'invalid',
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    validatePasswordResetToken(token)
      .then((res) => {
        if (!cancelled) setLinkState(res.data.valid ? 'valid' : 'invalid');
      })
      .catch(() => {
        // Could not check (offline, say): let them try; the submit decides.
        if (!cancelled) setLinkState('valid');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const policyError = passwordPolicyError(password);
  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_OR_EXPIRED_TOKEN') {
        setLinkState('invalid');
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (linkState === 'checking') return <Spinner label="Checking your reset link…" />;
  if (linkState === 'invalid') return <InvalidLink />;

  if (done) {
    return (
      <>
        <h1 className="mb-2 text-lg font-semibold text-fg">Password changed</h1>
        <p role="status" className="mb-4 text-sm text-fg-soft">
          Your password has been reset and you have been signed out on every device. Sign in with
          your new password.
        </p>
        <ButtonLink to="/login" replace>
          Go to sign in
        </ButtonLink>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1 className="mb-1 text-lg font-semibold text-fg">Choose a new password</h1>
      <p className="mb-4 text-sm text-muted">At least 8 characters, with a letter and a number.</p>
      <ErrorBanner message={error} />
      <div className="mb-3">
        <label className="mb-1 block text-sm font-medium text-fg-soft" htmlFor="reset-password">
          New password
        </label>
        <PasswordInput
          id="reset-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-3 py-2 text-sm"
        />
        <FieldError message={policyError} />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-fg-soft" htmlFor="reset-confirm">
          Confirm new password
        </label>
        <PasswordInput
          id="reset-confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="px-3 py-2 text-sm"
        />
        <FieldError message={mismatch ? 'These do not match.' : null} />
      </div>
      <Button
        type="submit"
        className="w-full"
        loading={submitting}
        disabled={!password || Boolean(policyError) || password !== confirm}
      >
        {submitting ? 'Saving…' : 'Reset password'}
      </Button>
      <p className="mt-4 text-center text-sm text-muted">
        <Link to="/login" className="font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

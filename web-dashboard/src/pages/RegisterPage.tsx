import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PasswordInput } from '../components/PasswordInput';
import { OrganizationNameStatus } from '../components/OrganizationNameStatus';
import { FieldError } from '../components/FieldError';
import { latinNameError } from '../utils/latinText';
import { useOrganizationNameAvailability } from '../hooks/useOrganizationNameAvailability';
import { AuthLoadingOverlay } from '../components/AuthLoadingOverlay';
import { useDelayedFlag } from '../hooks/useDelayedFlag';
import { useBackendWarmup } from '../hooks/useBackendWarmup';
import { AUTH_LOADER_DELAY_MS, startAuthTiming } from '../utils/authTiming';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const showLoader = useDelayedFlag(submitting, AUTH_LOADER_DELAY_MS);
  useBackendWarmup();
  // Organization names are unique like usernames; checked as you type.
  const nameStatus = useOrganizationNameAvailability(organizationName);
  const nameScriptError = latinNameError(organizationName);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const done = startAuthTiming('register');
    try {
      await register(organizationName, email, password);
      done('success');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      done('error');
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {showLoader && <AuthLoadingOverlay message="Creating your organization…" />}
      <ErrorBanner message={error} />
      <div className="mb-3">
        <label htmlFor="organizationName" className="mb-1 block text-sm font-medium text-fg-soft">
          Organization name
        </label>
        <input
          id="organizationName"
          required
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          aria-describedby="organizationName-status"
          aria-invalid={nameStatus === 'taken' || Boolean(nameScriptError) || undefined}
          className="w-full rounded-md border border-border-strong px-3 py-2 text-sm"
        />
        <OrganizationNameStatus
          status={nameStatus}
          id="organizationName-status"
          unknownText="Couldn't check right now — we'll confirm the name when you create the organization."
        />
        <FieldError message={nameScriptError} />
      </div>
      <div className="mb-3">
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-fg-soft">
          Owner email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-border-strong px-3 py-2 text-sm"
        />
      </div>
      <div className="mb-4">
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-fg-soft">
          Password
        </label>
        <PasswordInput
          id="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-faint">At least 8 characters, with a letter and a number.</p>
      </div>
      <Button
        type="submit"
        loading={submitting}
        disabled={nameStatus === 'taken' || Boolean(nameScriptError)}
        className="w-full"
      >
        {submitting ? 'Creating organization…' : 'Create organization'}
      </Button>
      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

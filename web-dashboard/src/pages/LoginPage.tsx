import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PasswordInput } from '../components/PasswordInput';
import { AuthLoadingOverlay } from '../components/AuthLoadingOverlay';
import { useDelayedFlag } from '../hooks/useDelayedFlag';
import { AUTH_LOADER_DELAY_MS, startAuthTiming } from '../utils/authTiming';
import { useBackendWarmup } from '../hooks/useBackendWarmup';

export function LoginPage() {
  useBackendWarmup();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const showLoader = useDelayedFlag(submitting, AUTH_LOADER_DELAY_MS);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const done = startAuthTiming('login');
    try {
      await login(email, password);
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
      {showLoader && <AuthLoadingOverlay message="Signing you in…" />}
      <ErrorBanner message={error} />
      <div className="mb-3">
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-fg-soft">
          Email
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
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="password" className="block text-sm font-medium text-fg-soft">
            Password
          </label>
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" loading={submitting} className="w-full">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="mt-4 text-center text-sm text-muted">
        No organization yet?{' '}
        <Link to="/register" className="font-medium text-brand-600 hover:underline">
          Register
        </Link>
      </p>
    </form>
  );
}

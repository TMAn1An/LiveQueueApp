import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { FieldError } from '../components/FieldError';
import { PasswordInput } from '../components/PasswordInput';
import { Spinner } from '../components/Spinner';
import {
  acceptSuccession,
  declineSuccession,
  reasonLabel,
  validateSuccessorLink,
  type SuccessorLinkCheck,
} from '../api/leadership.api';
import { ApiError } from '../api/client';
import { passwordPolicyError } from '../utils/passwordPolicy';
import { useBackendWarmup } from '../hooks/useBackendWarmup';

type Valid = Extract<SuccessorLinkCheck, { valid: true }>;

function InvalidLink() {
  return (
    <>
      <h1 className="mb-2 text-lg font-semibold text-fg">This handover link can&apos;t be used</h1>
      <p className="text-sm text-fg-soft">
        This handover link has expired or is no longer valid. If you expected it to work, ask the current
        Organization Head to start the handover again.
      </p>
    </>
  );
}

/**
 * ADR-071: where a successor lands from the "lead this organization" email.
 * The link is checked before anything is shown; the successor proves who they
 * are (a new person chooses a password, an existing member re-enters theirs)
 * and explicitly accepts responsibility. Nothing changes until they do.
 */
export function AcceptLeadershipPage() {
  useBackendWarmup();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [link, setLink] = useState<'checking' | 'invalid' | Valid>(token ? 'checking' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    validateSuccessorLink(token)
      .then((res) => {
        if (!cancelled) setLink(res.data.valid ? res.data : 'invalid');
      })
      .catch(() => {
        if (!cancelled) setError('Could not check this link right now. Please try again in a moment.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (done === 'accepted' && typeof link === 'object') {
    return (
      <>
        <h1 className="mb-2 text-lg font-semibold text-fg">You are now the Organization Head</h1>
        <p className="mb-4 text-sm text-fg-soft">
          You lead {link.organizationName} on LiveQueue. Sign in with {link.successorEmail} to continue.
        </p>
        <Button onClick={() => navigate('/login', { replace: true })}>Go to sign in</Button>
      </>
    );
  }
  if (done === 'declined') {
    return (
      <>
        <h1 className="mb-2 text-lg font-semibold text-fg">Handover declined</h1>
        <p className="text-sm text-fg-soft">The current Organization Head has been told. Nothing else has changed.</p>
      </>
    );
  }
  if (link === 'checking') {
    return error ? <ErrorBanner message={error} /> : <Spinner label="Checking your handover link…" />;
  }
  if (link === 'invalid') return <InvalidLink />;

  const isNew = !link.existingMember;
  const policyError = isNew ? passwordPolicyError(password) : null;
  const mismatch = isNew && confirm.length > 0 && password !== confirm;
  const canAccept =
    acknowledged && password.length > 0 && !policyError && (!isNew || password === confirm) && busy === null;

  async function accept() {
    setError(null);
    setBusy('accept');
    try {
      await acceptSuccession(token, password);
      setDone('accepted');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'HEAD_SUCCESSION_INVALID') setLink('invalid');
      else setError(err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    setError(null);
    setBusy('decline');
    try {
      await declineSuccession(token);
      setDone('declined');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'HEAD_SUCCESSION_INVALID') setLink('invalid');
      else setError(err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-fg">Lead {link.organizationName}</h1>
      <p className="mb-4 text-sm text-muted">
        {link.currentHeadName} has asked you, {link.successorName}, to become the Organization Head.
      </p>
      <dl className="mb-4 grid grid-cols-1 gap-2 rounded-lg bg-subtle/50 p-3 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Organization</dt>
          <dd className="font-medium text-fg">{link.organizationName}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Current Organization Head</dt>
          <dd className="font-medium text-fg">{link.currentHeadName}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Reason</dt>
          <dd className="font-medium text-fg">{reasonLabel(link.reason)}</dd>
        </div>
      </dl>
      <p className="mb-4 text-sm text-fg-soft">
        As Organization Head you are responsible for the organization on LiveQueue: its Admins and their
        queues, its Organization Managers, and its settings. The current Head will lose access when the
        handover completes.
      </p>
      <ErrorBanner message={error} />

      <div className="mb-3">
        <label className="mb-1 block text-xs text-muted" htmlFor="leadership-password">
          {isNew ? 'Choose a password' : 'Your current password'}
        </label>
        <PasswordInput
          id="leadership-password"
          autoComplete={isNew ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-2 py-1.5 text-sm"
        />
        {isNew && <FieldError message={password ? policyError : null} />}
      </div>
      {isNew && (
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted" htmlFor="leadership-confirm">
            Confirm password
          </label>
          <PasswordInput
            id="leadership-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="px-2 py-1.5 text-sm"
          />
          {mismatch && <p className="mt-1 text-xs text-red-600">These do not match.</p>}
        </div>
      )}

      <label className="mb-4 flex items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>{link.acceptanceStatement}</span>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button disabled={!canAccept} loading={busy === 'accept'} onClick={() => void accept()}>
          {busy === 'accept' ? 'Accepting…' : 'Accept responsibility'}
        </Button>
        <Button variant="secondary" disabled={busy !== null} loading={busy === 'decline'} onClick={() => void decline()}>
          Decline
        </Button>
      </div>
      <p className="mt-4 text-xs text-faint">
        Not you? <Link to="/login" className="text-brand-600 hover:underline">Go to sign in</Link>
      </p>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { forgetVisit, getBrowserInstallationId } from '../installation';
import { NotificationsCard } from '../NotificationsCard';
import { portalApi } from '../portalApi';
import { TERMINAL_STATUSES, useLiveToken } from '../useLiveToken';
import { Card, Loading, Notice, SecondaryButton, Shell } from '../ui';
import { minutesLabel } from '../format';
import { JourneyProgress } from '../../shared/journey/JourneyProgress';

const STATUS_TEXT: Record<string, { title: string; tone: 'info' | 'ok' | 'warn' }> = {
  WAITING: { title: 'You are in the queue', tone: 'info' },
  CALLED: { title: 'It’s your turn', tone: 'ok' },
  IN_PROGRESS: { title: 'You are being served', tone: 'ok' },
  COMPLETED: { title: 'Your visit is complete', tone: 'info' },
  SKIPPED: { title: 'Your token was skipped', tone: 'warn' },
  CANCELLED: { title: 'You left the queue', tone: 'info' },
};

/** ADR-068: one visit, live while the page is open, with optional notifications. */
export function TrackingPage() {
  const { tokenId = '' } = useParams();
  const installationId = getBrowserInstallationId();
  const { token, error, live, refresh } = useLiveToken(tokenId);
  const [code, setCode] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    // Opening the visit clears any Home Screen badge.
    (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => undefined);
  }, []);

  // The service-start code is shown only to the browser that owns the visit,
  // and only once called (the backend enforces both).
  const showsCode = token?.status === 'CALLED' && token.serviceStartVerificationRequired;
  useEffect(() => {
    if (!showsCode) return;
    portalApi
      .verificationCode(tokenId, installationId)
      .then((result) => setCode(result.code))
      .catch(() => setCode(null));
  }, [showsCode, tokenId, installationId]);

  if (error && !token) {
    return (
      <Shell title="Visit not found">
        <Notice tone="error">{error}</Notice>
        <Link to="/visit" className="block text-center text-sm font-semibold text-brand-fg underline">
          Back
        </Link>
      </Shell>
    );
  }
  if (!token) return <Loading label="Loading your visit…" />;

  const status = STATUS_TEXT[token.status] ?? STATUS_TEXT.WAITING!;
  const terminal = TERMINAL_STATUSES.has(token.status);
  const eta = minutesLabel(token.estimatedWaitMinutes);

  async function leave() {
    setLeaving(true);
    try {
      await portalApi.cancel(tokenId, installationId);
      forgetVisit(tokenId);
      await refresh();
    } finally {
      setLeaving(false);
      setConfirmLeave(false);
    }
  }

  return (
    <Shell>
      <Card>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Your token</span>
          {!terminal && (
            <span
              data-testid="live-indicator"
              className={`flex items-center gap-1.5 text-xs font-medium ${live === 'live' ? 'text-emerald-700' : 'text-amber-700'}`}
            >
              <span className={`h-2 w-2 rounded-full ${live === 'live' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {live === 'live' ? 'Live' : 'Reconnecting…'}
            </span>
          )}
        </div>
        <p className="mt-1 text-5xl font-black tracking-tight" data-testid="serial">
          {token.serialNumber}
        </p>
        <h1 className="mt-3 text-xl font-bold">{token.queueRemoved ? 'Your place was cancelled' : status.title}</h1>
        {token.status === 'WAITING' && (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-subtle p-3">
              <dt className="text-muted">Position</dt>
              <dd className="text-2xl font-bold">{token.position ?? '—'}</dd>
            </div>
            <div className="rounded-xl bg-subtle p-3">
              <dt className="text-muted">Estimated wait</dt>
              <dd className="text-base font-bold">{eta ?? 'Not available yet'}</dd>
            </div>
          </dl>
        )}
        {(token.status === 'CALLED' || token.status === 'IN_PROGRESS') && token.counter && (
          <p className="mt-2 text-lg">
            Please go to <strong>{token.counter.name}</strong>.
          </p>
        )}
        {showsCode && code && (
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-fg">Show this code at the counter</p>
            <p className="mt-1 text-3xl font-black tracking-[0.3em]" data-testid="service-code">
              {code}
            </p>
          </div>
        )}
        {token.status === 'SKIPPED' && token.skipReason?.text && (
          <p className="mt-2 text-sm text-muted">{token.skipReason.text}</p>
        )}
        {token.status === 'COMPLETED' && token.completionFeedback && (
          <p className="mt-2 text-sm text-muted">{token.completionFeedback}</p>
        )}
        {token.queueRemoved && (
          <div className="mt-3">
            <Notice tone="warn">
              This queue has been closed, so your place was cancelled.
              {token.queueRemoved.reason ? ` Reason: ${token.queueRemoved.reason}` : ''}
            </Notice>
          </div>
        )}
        {!token.journey && token.services.length > 0 && (
          <p className="mt-3 text-sm text-muted">{token.services.map((s) => s.serviceName).join(', ')}</p>
        )}
      </Card>

      {token.journey && token.journey.totalSteps > 1 && (
        <Card>
          <JourneyProgress journey={token.journey} />
        </Card>
      )}

      {!terminal && <NotificationsCard tokenId={tokenId} installationId={installationId} />}

      {(token.status === 'WAITING' || token.status === 'CALLED') &&
        (confirmLeave ? (
          <Card>
            <p className="text-sm">Leave the queue? Your place will be given up.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <SecondaryButton onClick={() => setConfirmLeave(false)}>Stay</SecondaryButton>
              <button
                type="button"
                disabled={leaving}
                onClick={() => void leave()}
                className="min-h-12 rounded-xl bg-red-600 text-base font-semibold text-white disabled:opacity-50"
              >
                {leaving ? 'Leaving…' : 'Leave queue'}
              </button>
            </div>
          </Card>
        ) : (
          <SecondaryButton onClick={() => setConfirmLeave(true)}>Leave queue</SecondaryButton>
        ))}
    </Shell>
  );
}

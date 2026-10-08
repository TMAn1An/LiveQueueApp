import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMyCounter } from '../hooks/useCounters';
import { useQueue } from '../hooks/useQueues';
import { useCompleteToken, useNextToken, useStartToken } from '../hooks/useTokenActions';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { StatusBadge } from '../components/StatusBadge';
import { SkipTokenDialog } from '../components/SkipTokenDialog';
import { CompleteWithFeedbackDialog } from '../components/CompleteWithFeedbackDialog';
import { ReferralDialog } from '../components/ReferralDialog';
import { actionErrorMessage } from '../utils/actionError';
import type { CounterCurrentToken } from '../types/queue';
import { useConsoleConnection } from './useConsoleConnection';
import { formatElapsed, useElapsedSeconds } from './useElapsed';
import { readConsoleMode, writeConsoleMode, type ConsoleMode } from './preferences';

/**
 * ADR-072: the Floating Counter Console — a small control surface for the
 * person operating a counter, over the exact same workflow as the Live Queue
 * page. It holds no queue state of its own and decides nothing:
 *
 * - what it shows comes from GET /api/counters/mine (the counter, and the
 *   person called to or being served at it) and the queue's waiting count;
 * - every action is the existing endpoint through the existing hooks — Serve
 *   next never names a person, and the backend still decides who is next,
 *   whether a step may happen and whether this person may do it;
 * - nothing advances on the screen until the backend has answered and the
 *   refreshed state comes back.
 *
 * Privacy: token number and service only — no names, form answers or
 * contact details, because this window can sit on top of anything.
 */
export function FloatingCounterConsole({ surface, onClose }: { surface: 'pip' | 'dock'; onClose: () => void }) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const connection = useConsoleConnection();
  const { data: counter, isLoading, isError } = useMyCounter();
  const { data: queue } = useQueue(counter?.queueId);
  const [mode, setMode] = useState<ConsoleMode>(readConsoleMode);

  const canOperate = hasPermission('operate_tokens');

  function toggleMode() {
    const next: ConsoleMode = mode === 'compact' ? 'expanded' : 'compact';
    setMode(next);
    writeConsoleMode(next);
  }

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['counters', 'mine'] });

  let body;
  if (!canOperate) {
    body = (
      <Notice title="Access changed" role="alert">
        You can no longer serve from this console.
      </Notice>
    );
  } else if (isLoading) {
    body = <p className="text-sm text-muted">Loading your counter…</p>;
  } else if (isError && counter === undefined) {
    body = (
      <Notice title="Can't load your counter" role="alert">
        Check your connection. The console will update when the dashboard reconnects.
      </Notice>
    );
  } else if (!counter) {
    body = (
      <Notice title="No counter assigned" role="status">
        You are not assigned to a counter, so there is nothing to serve from here.
      </Notice>
    );
  } else {
    body = (
      <OperatingView
        key={counter.id}
        mode={mode}
        counterName={counter.name}
        counterStatus={counter.status}
        queueId={counter.queueId}
        waitingCount={queue?.waitingCount}
        current={counter.currentToken ?? null}
        held={connection !== 'live'}
        onSettled={refresh}
        onOpenLiveQueue={() => navigate(`/queues/${counter.queueId}/live`)}
      />
    );
  }

  return (
    <section
      aria-label="Floating counter console"
      className={`flex min-w-0 flex-col gap-2 bg-surface p-3 text-fg ${surface === 'pip' ? 'min-h-screen' : ''}`}
      data-testid="floating-counter-console"
      data-surface={surface}
    >
      <header className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-600 text-[10px] font-bold text-white"
        >
          LQ
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {counter ? counter.name : 'Counter console'}
        </span>
        <ConnectionPill state={connection} />
        <button
          type="button"
          onClick={toggleMode}
          aria-pressed={mode === 'expanded'}
          className="rounded-md px-1.5 py-1 text-xs font-medium text-muted hover:bg-subtle hover:text-fg"
        >
          {mode === 'compact' ? 'Expand' : 'Compact'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close floating console"
          className="rounded-md p-1 text-faint hover:bg-subtle hover:text-fg"
        >
          ✕
        </button>
      </header>
      {body}
    </section>
  );
}

function Notice({ title, children, role }: { title: string; children: React.ReactNode; role: 'alert' | 'status' }) {
  return (
    <div role={role} className="rounded-lg border border-border bg-subtle/60 p-3">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{children}</p>
    </div>
  );
}

function ConnectionPill({ state }: { state: 'live' | 'reconnecting' | 'checking' }) {
  if (state === 'live') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Live
      </span>
    );
  }
  return (
    <span
      role="status"
      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
      {state === 'checking' ? 'Checking access…' : 'Reconnecting…'}
    </span>
  );
}

const COUNTER_STATE_HINT: Record<string, string> = {
  ON_BREAK: 'Your counter is paused. Ask the organization owner or an admin to open it.',
  OFFLINE: 'Your counter is off.',
};

function OperatingView({
  mode,
  counterName,
  counterStatus,
  queueId,
  waitingCount,
  current,
  held,
  onSettled,
  onOpenLiveQueue,
}: {
  mode: ConsoleMode;
  counterName: string;
  counterStatus: string;
  queueId: string;
  waitingCount: number | undefined;
  current: CounterCurrentToken | null;
  /** Connection not live: show the last known state but take no actions. */
  held: boolean;
  onSettled: () => void;
  onOpenLiveQueue: () => void;
}) {
  const serveNext = useNextToken();
  const startToken = useStartToken();
  const completeToken = useCompleteToken();
  const [error, setError] = useState<string | null>(null);
  const [enteringCode, setEnteringCode] = useState(false);
  const [code, setCode] = useState('');
  const [dialog, setDialog] = useState<'skip' | 'feedback' | 'refer' | null>(null);

  const busy = serveNext.isPending || startToken.isPending || completeToken.isPending;
  const locked = busy || held;
  const open = counterStatus === 'ACTIVE';
  const hasNextStep = Boolean(current?.step && current.step.number < current.step.total);

  const since = current?.status === 'IN_PROGRESS' ? current.startedAt : current?.calledAt;
  const elapsed = useElapsedSeconds(since);

  // Every action: one request at a time, nothing shown as done until the
  // backend says so, and a fresh read afterwards either way (another device
  // may have acted first — the refreshed state then shows what happened).
  const settle = {
    onError: (err: unknown) => setError(actionErrorMessage(err)),
    onSettled,
  };

  function handleServeNext() {
    if (locked) return;
    setError(null);
    serveNext.mutate(queueId, settle);
  }

  function handleStart(e?: FormEvent) {
    e?.preventDefault();
    if (locked || !current) return;
    if (current.requiresVerificationCode && !enteringCode) {
      setError(null);
      setEnteringCode(true);
      return;
    }
    setError(null);
    startToken.mutate(
      current.requiresVerificationCode
        ? { tokenId: current.id, verificationCode: code.trim() }
        : { tokenId: current.id },
      {
        ...settle,
        onSuccess: () => {
          setEnteringCode(false);
          setCode('');
        },
      },
    );
  }

  function handleComplete() {
    if (locked || !current) return;
    setError(null);
    completeToken.mutate({ tokenId: current.id }, settle);
  }

  const closeDialog = () => {
    setDialog(null);
    onSettled();
  };

  // The one action that moves things forward from here, when there is one.
  let primary: React.ReactNode = null;
  if (!current) {
    primary = (
      <Button
        size="lg"
        className="w-full"
        disabled={!open || locked}
        loading={serveNext.isPending}
        onClick={handleServeNext}
      >
        {serveNext.isPending ? 'Calling…' : 'Serve next'}
      </Button>
    );
  } else if (current.status === 'CALLED' && !enteringCode) {
    primary = (
      <Button
        size="lg"
        className="w-full"
        disabled={locked}
        loading={startToken.isPending}
        onClick={() => handleStart()}
      >
        {startToken.isPending ? 'Starting…' : 'Start'}
      </Button>
    );
  } else if (current.status === 'IN_PROGRESS') {
    primary = (
      <Button size="lg" className="w-full" disabled={locked} loading={completeToken.isPending} onClick={handleComplete}>
        {completeToken.isPending ? 'Completing…' : hasNextStep ? 'Complete step' : 'Complete'}
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <StatusBadge status={counterStatus} size="sm" />
        <span>
          <span className="font-semibold text-fg-soft">{waitingCount ?? '–'}</span> waiting
        </span>
        {mode === 'expanded' && <span className="truncate">· {counterName}</span>}
      </div>

      {current ? (
        <div className="rounded-lg border border-border p-2.5" aria-live="polite">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-3xl font-bold tracking-tight" data-testid="console-token">
              {current.serialNumber}
            </span>
            {elapsed !== null && (
              <span className="text-sm font-medium tabular-nums text-fg-soft" data-testid="console-timer">
                <span className="sr-only">{current.status === 'IN_PROGRESS' ? 'Serving for ' : 'Called '}</span>
                {formatElapsed(elapsed)}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <StatusBadge status={current.status} size="sm" />
            {current.serviceName && <span className="min-w-0 truncate text-fg-soft">{current.serviceName}</span>}
            {current.step && current.step.total > 1 && (
              <span className="text-muted">
                · step {current.step.number} of {current.step.total}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted" aria-live="polite">
          {open ? 'Nobody at your counter.' : (COUNTER_STATE_HINT[counterStatus] ?? 'Your counter is not open.')}
        </p>
      )}

      {current?.status === 'CALLED' && enteringCode && (
        <form onSubmit={handleStart} className="flex min-w-0 items-center gap-1.5">
          <label htmlFor="console-verification-code" className="sr-only">
            Verification code
          </label>
          <input
            id="console-verification-code"
            autoFocus
            inputMode="numeric"
            autoComplete="off"
            placeholder="Verification code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 text-sm"
          />
          <Button type="submit" size="lg" disabled={locked || code.trim() === ''} loading={startToken.isPending}>
            {startToken.isPending ? 'Starting…' : 'Confirm'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEnteringCode(false);
              setCode('');
            }}
          >
            Cancel
          </Button>
        </form>
      )}

      {primary}

      {mode === 'expanded' && current && (
        <div className="grid grid-cols-2 gap-1.5">
          {current.status === 'IN_PROGRESS' && hasNextStep && (
            <Button variant="secondary" disabled={locked} onClick={() => setDialog('refer')}>
              Refer
            </Button>
          )}
          {current.status === 'IN_PROGRESS' && !hasNextStep && (
            <Button variant="secondary" disabled={locked} onClick={() => setDialog('feedback')}>
              Feedback
            </Button>
          )}
          <Button variant="outline" disabled={locked} onClick={() => setDialog('skip')}>
            Skip
          </Button>
        </div>
      )}

      {held && (
        <p className="text-[11px] text-muted" role="status">
          Actions resume when the connection is back.
        </p>
      )}
      <ErrorBanner message={error} />

      {mode === 'expanded' && (
        <button
          type="button"
          onClick={onOpenLiveQueue}
          className="self-start text-xs font-semibold text-brand-fg underline"
        >
          Open Live Queue
        </button>
      )}

      {current && dialog === 'skip' && <SkipTokenDialog tokenId={current.id} onClose={closeDialog} />}
      {current && dialog === 'feedback' && <CompleteWithFeedbackDialog tokenId={current.id} onClose={closeDialog} />}
      {current && dialog === 'refer' && <ReferralDialog tokenId={current.id} onClose={closeDialog} />}
    </div>
  );
}

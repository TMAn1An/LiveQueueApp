import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { useMyCounter } from '../hooks/useCounters';
import { useNextToken } from '../hooks/useTokenActions';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { InfoHelp } from './InfoHelp';
import { PermissionGate } from './PermissionGate';
import { StatusBadge } from './StatusBadge';
import { actionErrorMessage } from '../utils/actionError';
import { useFloatingConsole } from '../floatingConsole/useFloatingConsole';

/**
 * ADR-064: the one way to take someone from the line.
 *
 * "Serve next" claims the next eligible person — strict first come, first
 * served — for the signed-in person (owner, admin or staff), at the one
 * counter they are assigned to. There is deliberately no counter picker, no staff picker
 * and no way to choose a particular person: the backend derives the counter
 * from the session and refuses anything else.
 */
export function ServeNextPanel({ queueId }: { queueId: string }) {
  const { hasPermission } = useAuth();
  const managesCounters = hasPermission('manage_staff');
  const { data: myCounter, isLoading } = useMyCounter();
  const serveNext = useNextToken();
  const [error, setError] = useState<string | null>(null);
  const [lastServed, setLastServed] = useState<string | null>(null);
  // ADR-072: absent outside the signed-in layout (and in isolated tests).
  const floatingConsole = useFloatingConsole();

  if (isLoading) return null;

  const frame = 'rounded-xl border border-border bg-surface p-4 shadow-xs';

  if (!myCounter) {
    return (
      <PermissionGate permission="operate_tokens">
        <div className={frame} data-testid="serve-next-panel">
          <p className="text-sm font-semibold text-fg">You are not assigned to a counter</p>
          {managesCounters ? (
            <p className="mt-1 text-sm text-muted">
              Owners, admins and staff serve only from a counter they are assigned to. To serve here,
              assign yourself to a counter under{' '}
              <Link to={`/queues/${queueId}/counters`} className="font-semibold text-brand-fg underline">
                Counters
              </Link>
              .
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              The organization owner or an admin assigns each person to a counter. Once you have one,
              you can serve the next person here.
            </p>
          )}
        </div>
      </PermissionGate>
    );
  }

  if (myCounter.queueId !== queueId) {
    return (
      <PermissionGate permission="operate_tokens">
        <div className={frame} data-testid="serve-next-panel">
          <p className="text-sm font-semibold text-fg">
            Your counter, {myCounter.name}, serves {myCounter.queueName}
          </p>
          <p className="mt-1 text-sm text-muted">
            You can only serve people from the queue your counter belongs to.{' '}
            <Link to={`/queues/${myCounter.queueId}/live`} className="font-semibold text-brand-fg underline">
              Go to {myCounter.queueName}
            </Link>
          </p>
        </div>
      </PermissionGate>
    );
  }

  const active = myCounter.status === 'ACTIVE';

  return (
    <PermissionGate permission="operate_tokens">
      <div className={frame} data-testid="serve-next-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-0.5 text-xs font-semibold uppercase tracking-wider text-muted">
              Your counter
              <InfoHelp label="your counter">
                The organization owner or an admin assigns you to a counter. You serve only from it,
                and only the next person in line.
              </InfoHelp>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-fg">{myCounter.name}</span>
              <StatusBadge status={myCounter.status} size="sm" />
            </div>
            {!active && (
              <p className="mt-1 text-xs text-muted">
                Your counter is not open. Ask the organization owner or an admin to open it.
              </p>
            )}
            {lastServed && (
              <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300" role="status">
                Called {lastServed} to {myCounter.name}.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {floatingConsole && (
              <Button
                variant="secondary"
                size="lg"
                onClick={floatingConsole.open}
                title={
                  floatingConsole.pipSupported
                    ? 'A small window that stays on top of your other windows'
                    : 'A small console docked on this page'
                }
              >
                {floatingConsole.surface ? 'Show floating console' : 'Open floating console'}
              </Button>
            )}
            <Button
              size="lg"
              disabled={!active}
              loading={serveNext.isPending}
              onClick={() => {
                setError(null);
                setLastServed(null);
                serveNext.mutate(queueId, {
                  onSuccess: (res) => setLastServed(res.data.serialNumber),
                  onError: (err) => setError(actionErrorMessage(err)),
                });
              }}
            >
              {serveNext.isPending ? 'Calling…' : 'Serve next'}
            </Button>
          </div>
        </div>
        <ErrorBanner message={error} />
      </div>
    </PermissionGate>
  );
}

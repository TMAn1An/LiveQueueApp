import { Link, useParams } from 'react-router-dom';
import { useQueue } from '../hooks/useQueues';
import { useCounters } from '../hooks/useCounters';
import { Card } from '../components/Card';
import { SectionHeading } from '../components/SectionHeading';
import { Button } from '../components/Button';
import { QueueBreadcrumb } from '../components/QueueBreadcrumb';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { LiveQueueTable } from '../components/LiveQueueTable';

/**
 * Operational Live Queue View (ADR-036).
 * Designed for staff working quickly under pressure: immediate visibility into
 * queue status, active counters, waiting line, and next eligible actions.
 */
export function QueueLivePage() {
  const { queueId } = useParams<{ queueId: string }>();
  const { data: queue, isLoading } = useQueue(queueId);
  const { data: counters } = useCounters(queueId);

  if (isLoading || !queue) return <Spinner label="Loading queue…" />;

  const activeCounters = (counters ?? []).filter((counter) => counter.status === 'ACTIVE');
  const waiting = queue.waitingCount ?? 0;

  return (
    <div className="space-y-6">
      {/* Queue Header & Context */}
      <div>
        <QueueBreadcrumb
          queueId={queue.id}
          queueName={queue.name}
          section="Live Queue"
          backTo="/queues"
          backLabel="Back to Queues"
        />
        <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-subtle text-xs font-bold text-fg-soft border border-border">
                  {queue.tokenPrefix}
                </span>
                <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
                  {queue.name}
                </h1>
                <StatusBadge status={queue.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                <span className="font-medium text-fg-soft">
                  {waiting} {waiting === 1 ? 'customer waiting' : 'customers waiting'}
                </span>
                {queue.scheduleEnabled && (
                  <>
                    <span>·</span>
                    <span className="text-brand-fg font-medium">Scheduled</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link to={`/queues/${queue.id}/counters`}>
                <Button variant="secondary" size="lg">
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm.75 6.75a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5zm-.75 6.5a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  Manage Counters
                </Button>
              </Link>
              <Link to={`/queues/${queue.id}`}>
                <Button variant="secondary">Queue Settings</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Warning callout when queue has no active counters */}
      {activeCounters.length === 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900 shadow-xs dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0 text-amber-600 mt-0.5">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <div>
              <p>
                This queue has no active counter, so nobody can be called and no waiting time can be
                estimated. Open a counter under{' '}
                <Link to={`/queues/${queue.id}/counters`} className="font-semibold underline">
                  Counters
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Waiting Line & Active Tokens Table */}
      <Card>
        <SectionHeading
          title="Waiting Line"
          help="Everyone waiting, called or being served in this queue, in the order they joined — first come, first served."
          className="flex-wrap"
          actions={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-fg-soft border border-border">
              <span className={`h-1.5 w-1.5 rounded-full ${activeCounters.length > 0 ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              {activeCounters.length} active{' '}
              {activeCounters.length === 1 ? 'counter' : 'counters'}
            </span>
          }
        />
        <LiveQueueTable
          queueId={queue.id}
          emptyMessage="Nobody is waiting, called, or in progress in this queue."
        />
      </Card>
    </div>
  );
}

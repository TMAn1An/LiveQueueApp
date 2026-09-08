import { Link, useParams } from 'react-router-dom';
import { useQueue } from '../hooks/useQueues';
import { useCounters } from '../hooks/useCounters';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { LiveQueueTable } from '../components/LiveQueueTable';

/**
 * One queue's operational view (ADR-036): its waiting line, and the counters
 * that can actually serve it. Nothing from any other queue appears here —
 * not a customer, not a counter, not a unit of capacity.
 */
export function QueueLivePage() {
  const { queueId } = useParams<{ queueId: string }>();
  const { data: queue, isLoading } = useQueue(queueId);
  const { data: counters } = useCounters(queueId);

  if (isLoading || !queue) return <Spinner label="Loading queue…" />;

  const activeCounters = (counters ?? []).filter((counter) => counter.status === 'ACTIVE');

  return (
    <div className="space-y-6">
      <div>
        <nav className="mb-2 text-xs text-muted">
          <Link to="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span className="mx-1">/</span>
          <Link to="/queues" className="hover:underline">
            Queues
          </Link>
          <span className="mx-1">/</span>
          <span className="text-fg-soft">{queue.name}</span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-fg">{queue.name}</h1>
            <StatusBadge status={queue.status} />
          </div>
          <div className="flex gap-2">
            <Link to={`/queues/${queue.id}/counters`}>
              <Button variant="secondary">Counters</Button>
            </Link>
            <Link to={`/queues/${queue.id}`}>
              <Button variant="secondary">Queue Settings</Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Capacity is a property of this queue alone: another queue's active
          counters can never call a customer standing in this one. */}
      {activeCounters.length === 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          This queue has no active counter, so nobody can be called and no waiting time can be
          estimated. Open a counter under{' '}
          <Link to={`/queues/${queue.id}/counters`} className="underline">
            Counters
          </Link>
          .
        </div>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg-soft">Waiting Line</h2>
          <span className="text-xs text-muted">
            {activeCounters.length} active{' '}
            {activeCounters.length === 1 ? 'counter' : 'counters'}
          </span>
        </div>
        <LiveQueueTable
          queueId={queue.id}
          emptyMessage="Nobody is waiting, called, or in progress in this queue."
        />
      </Card>
    </div>
  );
}

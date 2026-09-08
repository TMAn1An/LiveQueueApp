import { Link } from 'react-router-dom';
import { useDashboardStats } from '../hooks/useDashboard';
import { useQueues } from '../hooks/useQueues';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { formatMinutes } from '../utils/format';
import type { DashboardStats } from '../types/dashboard';
import type { Queue } from '../types/queue';

const STAT_CARDS: { key: keyof DashboardStats; label: string; minutes?: boolean }[] = [
  { key: 'activeQueues', label: 'Active Queues' },
  { key: 'waitingTokens', label: 'Waiting Tokens' },
  { key: 'calledTokens', label: 'Called Tokens' },
  { key: 'activeCounters', label: 'Active Counters' },
  { key: 'countersOnBreak', label: 'Counters on Break' },
  { key: 'averageWaitTimeMinutes', label: 'Avg Wait Time', minutes: true },
  { key: 'averageServiceTimeMinutes', label: 'Avg Service Time', minutes: true },
  { key: 'completedToday', label: 'Completed Today' },
  { key: 'skippedToday', label: 'Skipped Today' },
];

/**
 * ADR-036: the dashboard opens on the organization's queues, not on one
 * merged list of every customer in the building.
 *
 * Each queue is an independent line — its own arrival order, its own
 * counters, its own capacity — so a table that interleaved them showed
 * "position 1" several times over and locked states that could not be
 * explained by the rows above them. Staff work at one queue; they pick it
 * here and see only it.
 */
function QueueCard({ queue }: { queue: Queue }) {
  const waiting = queue.waitingCount ?? 0;
  const activeCounters = queue.activeCounterCount ?? 0;

  return (
    <Link
      to={`/queues/${queue.id}/live`}
      className="block rounded-lg border border-border bg-surface p-4 transition-colors duration-150 hover:border-brand-400 hover:bg-subtle"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold text-fg">{queue.name}</h3>
        <StatusBadge status={queue.status} />
      </div>
      <p className="text-sm text-fg-soft">
        {waiting} {waiting === 1 ? 'customer waiting' : 'customers waiting'}
      </p>
      <p className="text-sm text-muted">
        {activeCounters} {activeCounters === 1 ? 'active counter' : 'active counters'}
      </p>
      {/* The one combination that stops the line dead: people waiting and
          nobody able to serve them. Worth saying on the card rather than
          leaving a supervisor to work it out from two numbers. */}
      {waiting > 0 && activeCounters === 0 && (
        <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          Nobody can be called — no active counter
        </p>
      )}
    </Link>
  );
}

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: queues, isLoading: queuesLoading } = useQueues();

  const activeQueues = (queues ?? []).filter((queue) => !queue.deletedAt);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-fg">Dashboard</h1>

      {statsLoading || !stats ? (
        <Spinner label="Loading stats…" />
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {STAT_CARDS.map(({ key, label, minutes }) => (
            <Card key={key}>
              <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
              <p className="mt-1 text-2xl font-bold text-fg">
                {minutes ? formatMinutes(stats[key] as number | null) : stats[key]}
              </p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg-soft">Your Queues</h2>
          <Link to="/queues" className="text-sm text-brand-600 hover:underline">
            Manage queues
          </Link>
        </div>
        {queuesLoading ? (
          <Spinner label="Loading queues…" />
        ) : activeQueues.length === 0 ? (
          <EmptyState message="No queues yet. Create one to start serving customers." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeQueues.map((queue) => (
              <QueueCard key={queue.id} queue={queue} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

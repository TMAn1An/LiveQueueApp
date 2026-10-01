import { Link } from 'react-router-dom';
import { useDashboardStats } from '../hooks/useDashboard';
import { useQueues } from '../hooks/useQueues';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/Card';
import { InfoHelp } from '../components/InfoHelp';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { PageHeader } from '../components/PageHeader';
import { PermissionGate } from '../components/PermissionGate';
import { formatMinutes } from '../utils/format';
import type { Queue } from '../types/queue';

function getGreeting(name?: string): string {
  const hour = new Date().getHours();
  let timeGreeting = 'Good morning';
  if (hour >= 12 && hour < 17) {
    timeGreeting = 'Good afternoon';
  } else if (hour >= 17) {
    timeGreeting = 'Good evening';
  }
  return name ? `${timeGreeting}, ${name}` : timeGreeting;
}

function QueueSummaryCard({ queue }: { queue: Queue }) {
  const waiting = queue.waitingCount ?? 0;
  const activeCounters = queue.activeCounterCount ?? 0;
  const totalCounters = queue.counterCount ?? 0;
  const hasNoCounters = waiting > 0 && activeCounters === 0;

  return (
    <div className={`relative flex flex-col justify-between rounded-xl border bg-surface p-5 shadow-xs transition-all duration-150 hover:shadow-sm ${
      hasNoCounters
        ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50/20'
        : 'border-border hover:border-border-strong'
    }`}>
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-subtle text-xs font-bold text-fg-soft border border-border">
                {queue.tokenPrefix}
              </span>
              <h3 className="truncate text-base font-semibold text-fg">
                {queue.name}
              </h3>
            </div>
            {queue.description && (
              <p className="mt-1 line-clamp-1 text-xs text-muted">
                {queue.description}
              </p>
            )}
          </div>
          <StatusBadge status={queue.status} size="sm" />
        </div>

        {/* Operational counts grid */}
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-subtle/80 p-3">
          <div>
            <span className="block text-[11px] font-medium text-muted">Waiting</span>
            <span className="mt-0.5 block text-xl font-bold text-fg">
              {waiting}
            </span>
          </div>
          <div>
            <span className="block text-[11px] font-medium text-muted">Active Counters</span>
            <span className="mt-0.5 block text-xl font-bold text-fg">
              {activeCounters}
              <span className="text-xs font-normal text-muted"> / {totalCounters}</span>
            </span>
          </div>
        </div>

        {/* Warning callout for stalled queue */}
        {hasNoCounters && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-100/70 dark:bg-amber-950/60 p-2.5 text-xs font-medium text-amber-900 dark:text-amber-200">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-amber-600">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <span>No active counters. Staff cannot call waiting customers.</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {/* Three buttons do not fit one row at this card's width, so the layout
          is deliberate rather than left to wrap: the main action on top, the
          two secondary ones sharing the row beneath. One size throughout, and
          Manage Counters is a real button, not a faint text link. */}
      <div className="mt-5 space-y-2 border-t border-border pt-4">
        <Link to={`/queues/${queue.id}/live`} className="block">
          <Button variant="primary" size="md" className="w-full">
            Open Queue
          </Button>
        </Link>
        <div className="flex gap-2">
          <Link to={`/queues/${queue.id}/counters`} className="min-w-0 flex-1">
            <Button variant="secondary" size="md" className="w-full">
              Manage Counters ({totalCounters})
            </Button>
          </Link>
          <Link to={`/queues/${queue.id}`}>
            <Button variant="outline" size="md">
              Settings
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { staff, organization } = useAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: queues, isLoading: queuesLoading } = useQueues();

  const activeQueues = (queues ?? []).filter((q) => !q.deletedAt);
  const stalledQueues = activeQueues.filter((q) => (q.waitingCount ?? 0) > 0 && (q.activeCounterCount ?? 0) === 0);

  return (
    <div className="space-y-6">
      {/* Welcome & Context Header */}
      <PageHeader
        title={getGreeting(staff?.name)}
        description={`Here is what needs your attention today across ${organization?.name ?? 'your organization'}.`}
        helpLabel="this overview"
        actions={
          <div className="flex items-center gap-2.5">
            <Link to="/queues">
              <Button variant="outline">View All Queues</Button>
            </Link>
            <PermissionGate permission="manage_queues">
              <Link to="/queues">
                <Button variant="primary">
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                  </svg>
                  Create Queue
                </Button>
              </Link>
            </PermissionGate>
          </div>
        }
      />

      {/* Urgent Alert Banner if any queue has customers waiting with 0 counters open */}
      {stalledQueues.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-xs dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm">
                Attention needed: {stalledQueues.length} {stalledQueues.length === 1 ? 'queue has' : 'queues have'} waiting customers without active counters.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {stalledQueues.map((q) => (
                  <Link
                    key={q.id}
                    to={`/queues/${q.id}/counters`}
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 shadow-xs dark:bg-amber-900 dark:text-amber-100 hover:bg-amber-50"
                  >
                    Open counters for {q.name} ({q.waitingCount ?? 0} waiting) →
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Primary KPI Metrics Summary */}
      {statsLoading || !stats ? (
        <Spinner label="Loading dashboard metrics…" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-muted">
                <span className="text-xs font-semibold tracking-wider uppercase text-faint">Waiting</span>
                <span className="h-2 w-2 rounded-full bg-amber-500" />
              </div>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-fg">
                {stats.waitingTokens}
              </p>
            </div>
            <p className="mt-3 text-xs text-muted">
              {stats.calledTokens} customer{stats.calledTokens === 1 ? '' : 's'} called now
            </p>
          </Card>

          <Card className="flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-muted">
                <span className="text-xs font-semibold tracking-wider uppercase text-faint">Active Queues</span>
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-fg">
                {stats.activeQueues}
              </p>
            </div>
            <p className="mt-3 text-xs text-muted">
              {activeQueues.length} total operational
            </p>
          </Card>

          <Card className="flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-muted">
                <span className="text-xs font-semibold tracking-wider uppercase text-faint">Active Counters</span>
                <span className="h-2 w-2 rounded-full bg-brand-500" />
              </div>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-fg">
                {stats.activeCounters}
              </p>
            </div>
            <p className="mt-3 text-xs text-muted">
              {stats.countersOnBreak} on break
            </p>
          </Card>

          <Card className="flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-muted">
                <span className="text-xs font-semibold tracking-wider uppercase text-faint">Completed Today</span>
                <span className="h-2 w-2 rounded-full bg-slate-400" />
              </div>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-fg">
                {stats.completedToday}
              </p>
            </div>
            <p className="mt-3 text-xs text-muted">
              Avg wait: {formatMinutes(stats.averageWaitTimeMinutes)}
            </p>
          </Card>
        </div>
      )}

      {/* Operational Queues Workspace Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <h2 className="text-lg font-bold tracking-tight text-fg">Operational Queues</h2>
            <InfoHelp label="Operational Queues">
              Your active queues. Open one to call tokens, or go to its counters and settings.
            </InfoHelp>
          </div>
          <Link to="/queues" className="text-xs font-semibold text-brand-fg hover:underline">
            Manage all queues →
          </Link>
        </div>

        {queuesLoading ? (
          <Spinner label="Loading queues…" />
        ) : activeQueues.length === 0 ? (
          /* First-time Onboarding-Oriented Empty State */
          <div className="rounded-2xl border-2 border-dashed border-border bg-surface p-8 text-center sm:p-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-950/60 text-brand-600">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
            </div>
            <h3 className="mt-4 text-xl font-bold text-fg">
              Create your first queue
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              LiveQueue gives your organization digital tokens, live counter assignment, and instant QR entry for arriving customers.
            </p>
            <div className="mt-6 flex justify-center">
              <Link to="/queues">
                <Button size="lg" variant="primary">
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                  </svg>
                  Create Queue
                </Button>
              </Link>
            </div>

            {/* 4-Step Visual Roadmap */}
            <div className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-border bg-subtle/50 p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>
                <h4 className="mt-2 text-sm font-semibold text-fg">Create Queue</h4>
                <p className="mt-1 text-xs text-muted">Set up your queue name and token prefix.</p>
              </div>
              <div className="rounded-xl border border-border bg-subtle/50 p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span>
                <h4 className="mt-2 text-sm font-semibold text-fg">Add Counters</h4>
                <p className="mt-1 text-xs text-muted">Configure desks where staff call customers.</p>
              </div>
              <div className="rounded-xl border border-border bg-subtle/50 p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">3</span>
                <h4 className="mt-2 text-sm font-semibold text-fg">Share QR</h4>
                <p className="mt-1 text-xs text-muted">Display or print the QR code for joining.</p>
              </div>
              <div className="rounded-xl border border-border bg-subtle/50 p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">4</span>
                <h4 className="mt-2 text-sm font-semibold text-fg">Serve Live</h4>
                <p className="mt-1 text-xs text-muted">Call tokens, verify, and complete service.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeQueues.map((queue) => (
              <QueueSummaryCard key={queue.id} queue={queue} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

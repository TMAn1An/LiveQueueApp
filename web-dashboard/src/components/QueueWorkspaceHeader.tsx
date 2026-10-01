import { Link } from 'react-router-dom';
import { StatusBadge } from './StatusBadge';
import { QueueBreadcrumb } from './QueueBreadcrumb';
import { Button } from './Button';
import type { Queue } from '../types/queue';

interface QueueWorkspaceHeaderProps {
  queue: Queue;
  activeCountersCount?: number;
  waitingCount?: number;
  currentSection?: 'live' | 'counters' | 'settings';
  activeSettingsTab?: string;
  onSelectSettingsTab?: (tab: string) => void;
}

export const QUEUE_SETTINGS_TABS = [
  { id: 'general', label: 'General & Timezone' },
  { id: 'services', label: 'Services & Verification' },
  { id: 'form', label: 'Customer Form' },
  { id: 'schedule', label: 'Schedule & Capacity' },
  { id: 'repeat', label: 'Repeat Visits' },
  { id: 'qr', label: 'QR Code & Entry' },
] as const;

export function QueueWorkspaceHeader({
  queue,
  activeCountersCount,
  waitingCount,
  currentSection = 'settings',
  activeSettingsTab = 'general',
  onSelectSettingsTab,
}: QueueWorkspaceHeaderProps) {
  const isLive = currentSection === 'live';
  const isCounters = currentSection === 'counters';
  const isSettings = currentSection === 'settings';

  const waiting = waitingCount ?? queue.waitingCount ?? 0;
  const activeCounters = activeCountersCount ?? queue.activeCounterCount ?? 0;

  return (
    <div className="space-y-4">
      {/* Universal Breadcrumb */}
      <QueueBreadcrumb
        queueId={queue.id}
        queueName={queue.name}
        section={isLive ? 'Live Queue' : isCounters ? 'Counters' : undefined}
        backTo="/queues"
        backLabel="Back to Queues"
      />

      {/* Main Workspace Bar */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-subtle text-xs font-bold text-fg-soft border border-border">
                {queue.tokenPrefix}
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
                {queue.name}
              </h1>
              <StatusBadge status={queue.status} />
              {queue.deletedAt && (
                <span className="rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-faint">
                  archived
                </span>
              )}
            </div>

            {/* Context metadata strip */}
            <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className="flex items-center gap-1.5 font-medium text-fg-soft">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {waiting} {waiting === 1 ? 'customer waiting' : 'customers waiting'}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5 font-medium text-fg-soft">
                <span className={`h-1.5 w-1.5 rounded-full ${activeCounters > 0 ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                {activeCounters} active {activeCounters === 1 ? 'counter' : 'counters'}
              </span>
              {queue.scheduleEnabled && (
                <>
                  <span>·</span>
                  <span className="text-brand-fg">Weekly Schedule Active</span>
                </>
              )}
            </div>
          </div>

          {/* Quick Nav Actions */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!isLive && (
              <Link to={`/queues/${queue.id}/live`}>
                <Button variant="primary" size="lg">
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                  Open Queue
                </Button>
              </Link>
            )}
            {!isCounters && (
              <Link to={`/queues/${queue.id}/counters`}>
                <Button variant={isLive ? 'primary' : 'secondary'} size="lg">
                  Manage Counters
                </Button>
              </Link>
            )}
            {!isSettings && (
              <Link to={`/queues/${queue.id}`}>
                <Button variant="secondary" size="lg">
                  Queue Settings
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Queue Workspace Sub-Navigation Tabs */}
        <div className="mt-5 border-t border-border pt-3">
          <nav className="flex flex-wrap gap-1" aria-label="Queue workspace sections">
            <Link
              to={`/queues/${queue.id}/live`}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                isLive
                  ? 'bg-brand-600 text-white dark:bg-brand-500'
                  : 'text-fg-soft hover:bg-subtle hover:text-fg'
              }`}
            >
              Live Queue ({waiting})
            </Link>
            <Link
              to={`/queues/${queue.id}/counters`}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                isCounters
                  ? 'bg-brand-600 text-white dark:bg-brand-500'
                  : 'text-fg-soft hover:bg-subtle hover:text-fg'
              }`}
            >
              Counters ({queue.counterCount ?? 0})
            </Link>

            <span className="mx-1 h-5 w-px bg-border self-center" />

            {QUEUE_SETTINGS_TABS.map((tab) => {
              const isActive = isSettings && activeSettingsTab === tab.id;
              return onSelectSettingsTab ? (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectSettingsTab(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-subtle text-fg font-bold border border-border-strong'
                      : 'text-muted hover:bg-subtle hover:text-fg'
                  }`}
                >
                  {tab.label}
                </button>
              ) : (
                <Link
                  key={tab.id}
                  to={`/queues/${queue.id}?tab=${tab.id}`}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-subtle hover:text-fg transition-colors"
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}

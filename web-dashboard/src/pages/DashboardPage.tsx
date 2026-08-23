import { useState } from 'react';
import { useDashboardStats, useLiveQueueTable } from '../hooks/useDashboard';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { Pagination } from '../components/Pagination';
import { TokenActions } from '../components/TokenActions';
import { formatDateTime, formatMinutes } from '../utils/format';
import type { DashboardStats } from '../types/dashboard';

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

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const [page, setPage] = useState(1);
  const { data: liveTable, isLoading: tableLoading } = useLiveQueueTable(page);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Dashboard</h1>

      {statsLoading || !stats ? (
        <Spinner label="Loading stats…" />
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {STAT_CARDS.map(({ key, label, minutes }) => (
            <Card key={key}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {minutes ? formatMinutes(stats[key] as number | null) : stats[key]}
              </p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Live Queue</h2>
        {tableLoading ? (
          <Spinner />
        ) : !liveTable?.data.length ? (
          <EmptyState message="No tokens currently waiting, called, or in progress." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                  <th className="py-2 pr-4">Token</th>
                  <th className="py-2 pr-4">Queue</th>
                  <th className="py-2 pr-4">Service</th>
                  <th className="py-2 pr-4">Position</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Counter</th>
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {liveTable.data.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4 text-lg font-bold text-slate-900">{row.serialNumber}</td>
                    <td className="py-2 pr-4">{row.queue.name}</td>
                    <td className="py-2 pr-4">{row.service.name}</td>
                    <td className="py-2 pr-4">{row.position ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="py-2 pr-4">{row.counter?.name ?? '—'}</td>
                    <td className="py-2 pr-4">{formatDateTime(row.calledAt ?? row.createdAt)}</td>
                    <td className="py-2 pr-4">
                      <TokenActions tokenId={row.id} queueId={row.queue.id} status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={liveTable?.pagination} onPageChange={setPage} />
      </Card>
    </div>
  );
}

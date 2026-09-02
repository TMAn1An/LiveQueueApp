import { useState } from 'react';
import { useDashboardStats, useLiveQueueTable } from '../hooks/useDashboard';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { Pagination } from '../components/Pagination';
import { TokenActions } from '../components/TokenActions';
import { Modal } from '../components/Modal';
import { formatDateTime, formatMinutes } from '../utils/format';
import type { DashboardStats, LiveQueueTokenRow } from '../types/dashboard';

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

/** V2 Checkpoint 5 (ADR-027): "Passport Renewal +2 more" — the full list
 * stays a plain tooltip rather than its own modal, since (unlike the
 * dynamic form fields below) there's rarely more than a handful of
 * services and nothing to click through to. */
function ServicesSummaryCell({ services }: { services: LiveQueueTokenRow['services'] }) {
  if (services.length === 0) {
    return <span className="text-slate-400">—</span>;
  }
  const [first, ...rest] = services;
  return (
    <span title={services.map((s) => s.name).join(', ')}>
      {first!.name}
      {rest.length > 0 ? ` +${rest.length} more` : ''}
    </span>
  );
}

/** A short one-line summary for the table cell — the full list is only ever
 * shown in the details modal, so the table never has to grow to fit
 * however many dynamic fields a queue happens to collect (Issue #4). */
function CustomerSummaryCell({ row, onOpenDetails }: { row: LiveQueueTokenRow; onOpenDetails: () => void }) {
  if (row.formFields.length === 0) {
    return <span className="text-slate-400">—</span>;
  }

  const first = row.formFields[0]!;
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="text-left text-blue-600 hover:underline"
      title="View submitted form details"
    >
      {first.value}
      {row.formFields.length > 1 ? ` (+${row.formFields.length - 1} more)` : ''}
    </button>
  );
}

function TokenDetailsModal({ row, onClose }: { row: LiveQueueTokenRow; onClose: () => void }) {
  return (
    <Modal title={`Token ${row.serialNumber}`} onClose={onClose}>
      <dl className="space-y-2 text-sm">
        {row.formFields.map((field) => (
          <div key={field.key}>
            <dt className="text-xs text-slate-400">{field.label}</dt>
            <dd className="text-slate-700">
              {field.type === 'phone' ? (
                <a href={`tel:${field.value}`} className="text-blue-600 hover:underline">
                  {field.value}
                </a>
              ) : field.type === 'email' ? (
                <a href={`mailto:${field.value}`} className="text-blue-600 hover:underline">
                  {field.value}
                </a>
              ) : (
                field.value
              )}
            </dd>
          </div>
        ))}
        {row.formFields.length === 0 && (
          <p className="text-xs italic text-slate-400">No form data was submitted for this token.</p>
        )}
      </dl>
    </Modal>
  );
}

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const [page, setPage] = useState(1);
  const { data: liveTable, isLoading: tableLoading } = useLiveQueueTable(page);
  const [detailsRow, setDetailsRow] = useState<LiveQueueTokenRow | null>(null);

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
                  <th className="py-2 pr-4">Customer</th>
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
                    <td className="py-2 pr-4">
                      <ServicesSummaryCell services={row.services} />
                    </td>
                    <td className="py-2 pr-4">
                      <CustomerSummaryCell row={row} onOpenDetails={() => setDetailsRow(row)} />
                    </td>
                    <td className="py-2 pr-4">{row.position ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="py-2 pr-4">{row.counter?.name ?? '—'}</td>
                    <td className="py-2 pr-4">{formatDateTime(row.calledAt ?? row.createdAt)}</td>
                    <td className="py-2 pr-4">
                      <TokenActions
                        tokenId={row.id}
                        queueId={row.queue.id}
                        status={row.status}
                        position={row.position}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={liveTable?.pagination} onPageChange={setPage} />
      </Card>

      {detailsRow && <TokenDetailsModal row={detailsRow} onClose={() => setDetailsRow(null)} />}
    </div>
  );
}

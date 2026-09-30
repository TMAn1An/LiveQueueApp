import { useState } from 'react';
import { useServiceHistory } from '../hooks/useServiceHistory';
import { useQueues } from '../hooks/useQueues';
import { Card } from '../components/Card';
import { Spinner, EmptyState, RefreshIndicator } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { PageHeader } from '../components/PageHeader';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatDateTime, formatMinutes } from '../utils/format';
import type { ServiceHistoryEntry, ServiceHistoryStatus } from '../types/serviceHistory';

export function ServiceHistoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServiceHistoryStatus>('COMPLETED');
  const [queueId, setQueueId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const debouncedSearch = useDebouncedValue(search.trim());
  const { data: queues } = useQueues();
  const { data: result, isLoading, isFetching } = useServiceHistory({
    page,
    pageSize: 20,
    search: debouncedSearch,
    status,
    queueId,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  });

  function withPageReset<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  const hasFilters = Boolean(debouncedSearch || queueId || from || to);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service History"
        description="Search and audit past visits across all queues in your organization — newest first."
      />

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-xs">
        <div className="w-full sm:w-72">
          <SearchInput
            value={search}
            onChange={withPageReset(setSearch)}
            label="Search service history"
            placeholder="Search by token, device, queue, or service…"
          />
        </div>
        <select
          value={status}
          onChange={(e) => withPageReset(setStatus)(e.target.value as ServiceHistoryStatus)}
          className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500"
          aria-label="Status"
        >
          <option value="COMPLETED">Completed</option>
          <option value="SKIPPED">Skipped</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select
          value={queueId}
          onChange={(e) => withPageReset(setQueueId)(e.target.value)}
          className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500"
          aria-label="Queue"
        >
          <option value="">All queues</option>
          {(queues ?? []).map((queue) => (
            <option key={queue.id} value={queue.id}>
              {queue.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={from}
            onChange={(e) => withPageReset(setFrom)(e.target.value)}
            className="rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg focus:border-brand-500"
            aria-label="From date"
          />
          <span className="text-xs text-muted">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => withPageReset(setTo)(e.target.value)}
            className="rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg focus:border-brand-500"
            aria-label="To date"
          />
        </div>
      </div>

      {isFetching && !isLoading && (
        <div className="flex justify-end">
          <RefreshIndicator />
        </div>
      )}

      <Card>
        {isLoading ? (
          <Spinner label="Loading service history…" />
        ) : !result?.data.length ? (
          <EmptyState
            message={
              hasFilters ? 'No visits match your search.' : 'No service history yet.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                  <th className="py-3 pr-4">Token</th>
                  <th className="py-3 pr-4">Queue</th>
                  <th className="py-3 pr-4">Service(s)</th>
                  <th className="py-3 pr-4">Customer Details</th>
                  <th className="py-3 pr-4">Counter</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Wait / Duration</th>
                  <th className="py-3 pr-4">Finished</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((entry) => {
                  const finishedAt = entry.completedAt ?? entry.skippedAt ?? entry.cancelledAt;
                  return (
                    <tr key={entry.tokenId} className="border-b border-border align-top transition-colors hover:bg-subtle/50">
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center rounded-md bg-subtle px-2 py-0.5 font-mono text-sm font-bold text-fg border border-border">
                          {entry.serialNumber}
                        </span>
                        {entry.deviceIdentifier && (
                          <div className="font-mono text-xs text-faint mt-0.5">{entry.deviceIdentifier}</div>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-medium text-fg">{entry.queue.name}</td>
                      <td className="py-3 pr-4 text-fg-soft">{entry.services.map((s) => s.name).join(', ') || '—'}</td>
                      <td className="py-3 pr-4">
                        {entry.formFields.length === 0 ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <dl className="space-y-0.5 text-xs">
                            {entry.formFields.map((field) => (
                              <div key={field.key}>
                                <dt className="inline text-faint">{field.label}: </dt>
                                <dd className="inline text-fg-soft">{field.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted">
                        {entry.counter?.name ?? '—'}
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={entry.status} size="sm" />
                        {entry.skipReason?.text && (
                          <p className="mt-1 max-w-xs text-xs text-fg-soft">
                            <span className="text-faint">Reason: </span>
                            {entry.skipReason.text}
                          </p>
                        )}
                        {entry.completionFeedback && (
                          <p className="mt-1 max-w-xs whitespace-pre-line text-xs text-fg-soft">
                            <span className="text-faint">Feedback: </span>
                            {entry.completionFeedback}
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs font-mono text-fg-soft whitespace-nowrap">
                        {formatMinutes(entry.actualDurationMinutes)}
                        <span className="ml-1 text-xs text-faint">
                          (est. {formatMinutes(entry.expectedDurationMinutes)})
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted whitespace-nowrap">
                        {formatDateTime(finishedAt ?? entry.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={result?.pagination} onPageChange={setPage} />
      </Card>
    </div>
  );
}

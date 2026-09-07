import { useState } from 'react';
import { useServiceHistory } from '../hooks/useServiceHistory';
import { useQueues } from '../hooks/useQueues';
import { Card } from '../components/Card';
import { Spinner, EmptyState } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatDateTime, formatMinutes } from '../utils/format';
import type { ServiceHistoryEntry, ServiceHistoryStatus } from '../types/serviceHistory';

/**
 * A record of visits that have finished — defaulting to COMPLETED, i.e. the
 * service actually given. SKIPPED and CANCELLED are reachable through the
 * status filter but are never mixed into the default view: a cancelled
 * visit is not a service rendered.
 *
 * Every field shown here is already exposed to these same roles elsewhere
 * in the dashboard (Live Queue, Device Blocking); the backend resolves the
 * customer's form answers against the form version that was live when they
 * submitted, and nothing new is surfaced just because it exists in the row.
 */
export function ServiceHistoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServiceHistoryStatus>('COMPLETED');
  const [queueId, setQueueId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Server-side search: this list grows with every visit the organization
  // ever serves, so filtering only the loaded page would hide most matches.
  const debouncedSearch = useDebouncedValue(search.trim());
  const { data: queues } = useQueues();
  const { data: result, isLoading } = useServiceHistory({
    page,
    pageSize: 20,
    search: debouncedSearch,
    status,
    queueId,
    // A date input gives a calendar day; the range has to cover the whole
    // of it, so the end bound is pushed to the last moment of that day.
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  });

  /** Any filter change re-queries from the start — staying on page 5 of the
   * previous result set would usually land past the end of the new one. */
  function withPageReset<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  const hasFilters = Boolean(debouncedSearch || queueId || from || to);

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold text-fg">Service History</h1>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Visits that have finished in your organization — completed service by default. Newest first.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput
          value={search}
          onChange={withPageReset(setSearch)}
          label="Search service history"
          placeholder="Search by token, device, queue, or service…"
        />
        <select
          value={status}
          onChange={(e) => withPageReset(setStatus)(e.target.value as ServiceHistoryStatus)}
          className="rounded-md border border-border-strong px-3 py-2 text-sm"
          aria-label="Status"
        >
          <option value="COMPLETED">Completed</option>
          <option value="SKIPPED">Skipped</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select
          value={queueId}
          onChange={(e) => withPageReset(setQueueId)(e.target.value)}
          className="rounded-md border border-border-strong px-3 py-2 text-sm"
          aria-label="Queue"
        >
          <option value="">All queues</option>
          {(queues ?? []).map((queue) => (
            <option key={queue.id} value={queue.id}>
              {queue.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => withPageReset(setFrom)(e.target.value)}
          className="rounded-md border border-border-strong px-3 py-2 text-sm"
          aria-label="From date"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => withPageReset(setTo)(e.target.value)}
          className="rounded-md border border-border-strong px-3 py-2 text-sm"
          aria-label="To date"
        />
      </div>

      <Card>
        {isLoading ? (
          <Spinner />
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
                <tr className="border-b border-border text-left text-xs uppercase text-faint">
                  <th className="py-2 pr-4">Token</th>
                  <th className="py-2 pr-4">Queue</th>
                  <th className="py-2 pr-4">Service(s)</th>
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4">Counter</th>
                  <th className="py-2 pr-4">Joined</th>
                  <th className="py-2 pr-4">Started</th>
                  <th className="py-2 pr-4">Finished</th>
                  <th className="py-2 pr-4">Duration</th>
                  <th className="py-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((entry) => (
                  <ServiceHistoryRow key={entry.tokenId} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={result?.pagination} onPageChange={setPage} />
      </Card>
    </div>
  );
}

function ServiceHistoryRow({ entry }: { entry: ServiceHistoryEntry }) {
  const finishedAt = entry.completedAt ?? entry.skippedAt ?? entry.cancelledAt;

  return (
    <tr className="border-b border-border align-top transition-colors duration-150 hover:bg-subtle">
      <td className="py-2 pr-4">
        <div className="font-medium text-fg">{entry.serialNumber}</div>
        <div className="font-mono text-xs text-faint">{entry.deviceIdentifier}</div>
      </td>
      <td className="py-2 pr-4">{entry.queue.name}</td>
      <td className="py-2 pr-4">{entry.services.map((s) => s.name).join(', ') || '—'}</td>
      <td className="py-2 pr-4">
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
      <td className="py-2 pr-4">{entry.counter?.name ?? '—'}</td>
      <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(entry.createdAt)}</td>
      <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(entry.startedAt)}</td>
      <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(finishedAt)}</td>
      <td className="py-2 pr-4 whitespace-nowrap">
        {formatMinutes(entry.actualDurationMinutes)}
        <span className="ml-1 text-xs text-faint">
          (est. {formatMinutes(entry.expectedDurationMinutes)})
        </span>
      </td>
      <td className="py-2 pr-4">
        <StatusBadge status={entry.status} />
      </td>
    </tr>
  );
}

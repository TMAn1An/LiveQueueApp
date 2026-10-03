import { useState } from 'react';
import { useAuditLogs } from '../hooks/useAuditLogs';
import { Card } from '../components/Card';
import { Spinner, EmptyState, RefreshIndicator } from '../components/Spinner';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { PageHeader } from '../components/PageHeader';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { formatActionLabel, formatDateTime } from '../utils/format';
import { AdminFilter } from '../components/AdminFilter';
import { useAuth } from '../context/AuthContext';

export function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [adminFilter, setAdminFilter] = useState('');
  const { hasPermission } = useAuth();
  const debouncedSearch = useDebouncedValue(search.trim());
  const { data: result, isLoading, isFetching } = useAuditLogs(page, 20, debouncedSearch, adminFilter);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Immutable record of sensitive actions, authentication events, and administrative changes."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full max-w-md">
          <SearchInput
            value={search}
            onChange={handleSearchChange}
            label="Search audit logs"
            placeholder="Search by staff, action, or entity…"
          />
        </div>
        {/* ADR-069: the Head and Managers may narrow to one Admin's workspace. */}
        {hasPermission('view_all_workspaces') && (
          <AdminFilter
            id="audit-admin-filter"
            value={adminFilter}
            onChange={(v) => {
              setAdminFilter(v);
              setPage(1);
            }}
          />
        )}
      </div>

      {isFetching && !isLoading && (
        <div className="flex justify-end">
          <RefreshIndicator />
        </div>
      )}

      <Card>
        {isLoading ? (
          <Spinner label="Loading audit logs…" />
        ) : !result?.data.length ? (
          <EmptyState
            message={debouncedSearch ? 'No audit events match your search.' : 'No audit events yet.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                  <th className="py-3 pr-4">Time</th>
                  <th className="py-3 pr-4">Staff</th>
                  <th className="py-3 pr-4">Action</th>
                  <th className="py-3 pr-4">Entity</th>
                  <th className="py-3 pr-4">Details</th>
                  <th className="py-3 pr-4">IP</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((entry) => (
                  <tr key={entry.id} className="border-b border-border align-top transition-colors hover:bg-subtle/50">
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-muted font-mono">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="py-3 pr-4 text-xs font-medium text-fg">{entry.staffEmail}</td>
                    <td className="py-3 pr-4">
                      <span className="inline-flex items-center rounded-md bg-subtle px-2 py-0.5 text-xs font-semibold text-fg-soft border border-border">
                        {formatActionLabel(entry.action)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-fg-soft">
                      <span className="text-muted">{entry.entityType}</span>
                      {entry.entityId && (
                        <span className="ml-1 font-mono text-xs text-faint">
                          {entry.entityId.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-muted max-w-xs truncate">
                      {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-faint">{entry.ipAddress ?? '—'}</td>
                  </tr>
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

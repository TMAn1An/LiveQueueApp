import { useState } from 'react';
import { useAuditLogs } from '../hooks/useAuditLogs';
import { Card } from '../components/Card';
import { Spinner, EmptyState } from '../components/Spinner';
import { Pagination } from '../components/Pagination';
import { formatActionLabel, formatDateTime } from '../utils/format';

/**
 * Consumes the existing GET /api/audit-logs endpoint (Phase 7) — the
 * backend already scopes results to the authenticated organization,
 * enforces `view_reports`, sanitizes metadata against secrets, and returns
 * newest-first. Nothing here re-derives or re-checks any of that; the page
 * only renders what the backend already decided was safe to return.
 */
export function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const { data: result, isLoading } = useAuditLogs(page, 20);

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold text-slate-900">Audit Logs</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        A record of staff actions in this organization — newest first.
      </p>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : !result?.data.length ? (
          <EmptyState message="No audit events yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Staff</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Entity</th>
                <th className="py-2 pr-4">Details</th>
                <th className="py-2 pr-4">IP</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(entry.createdAt)}</td>
                  <td className="py-2 pr-4">{entry.staffEmail}</td>
                  <td className="py-2 pr-4 font-medium text-slate-800">{formatActionLabel(entry.action)}</td>
                  <td className="py-2 pr-4">
                    <span className="text-slate-600">{entry.entityType}</span>
                    {entry.entityId && (
                      <span className="ml-1 font-mono text-xs text-slate-400">
                        {entry.entityId.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                    {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-400">{entry.ipAddress ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination pagination={result?.pagination} onPageChange={setPage} />
      </Card>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAssignQueueAdmin, useDeletedQueues, useQueues, useUpdateQueueStatus } from '../hooks/useQueues';
import { useAdmins } from '../hooks/useStaff';
import { AdminFilter } from '../components/AdminFilter';
import { useAuth } from '../context/AuthContext';
import { DeleteQueueDialog } from '../components/DeleteQueueDialog';
import { InfoHelp } from '../components/InfoHelp';
import { roleLabel } from '../types/auth';
import { formatDateTime } from '../utils/format';
import { Card } from '../components/Card';
import { Button, ButtonLink } from '../components/Button';
import { CreateQueueButton } from '../components/CreateQueueModal';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { PageHeader } from '../components/PageHeader';
import { actionErrorMessage } from '../utils/actionError';
import { PermissionGate } from '../components/PermissionGate';
import { SearchInput } from '../components/SearchInput';
import type { Queue, QueueStatus } from '../types/queue';

function AssignAdminControl({ queue }: { queue: Queue }) {
  const { admins } = useAdmins();
  const assign = useAssignQueueAdmin();
  const [error, setError] = useState<string | null>(null);
  const free = admins.filter((a) => a.id !== queue.adminId);
  return (
    <div className="mt-1">
      <label htmlFor={`assign-admin-${queue.id}`} className="sr-only">
        Assign {queue.name} to an Admin
      </label>
      <select
        id={`assign-admin-${queue.id}`}
        value=""
        disabled={assign.isPending || free.length === 0}
        onChange={(e) => {
          if (!e.target.value) return;
          setError(null);
          assign.mutate({ queueId: queue.id, adminId: e.target.value }, { onError: (err) => setError(actionErrorMessage(err)) });
        }}
        className="rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-fg focus:border-brand-500"
      >
        <option value="">{free.length === 0 ? 'Invite an Admin first' : 'Assign to an Admin…'}</option>
        {free.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function QueueRow({ queue, showAdmin }: { queue: Queue; showAdmin: boolean }) {
  const { hasPermission } = useAuth();
  const updateStatus = useUpdateQueueStatus(queue.id);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  // ADR-069: the server says whether this person may change the queue; the
  // Organization Head and Managers may delete any queue, an Admin their own.
  const canManage = queue.canManage !== false;
  const canDelete =
    hasPermission('delete_queues') && (canManage || hasPermission('view_all_workspaces'));

  const nextStatus: QueueStatus = queue.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';

  return (
    <tr className="border-b border-border transition-colors duration-150 hover:bg-subtle/60">
      <td className="py-3 pr-4">
        <div>
          <Link
            to={`/queues/${queue.id}/live`}
            className="font-semibold text-fg hover:text-brand-fg transition-colors"
          >
            {queue.name}
          </Link>
          {queue.deletedAt && <span className="ml-2 text-xs text-faint font-medium">(archived)</span>}
          {queue.description && (
            <p className="text-xs text-muted line-clamp-1 mt-0.5">{queue.description}</p>
          )}
        </div>
      </td>
      {showAdmin && (
        <td className="py-3 pr-4 text-sm">
          {queue.admin ? (
            <span className="text-fg-soft">{queue.admin.name}</span>
          ) : (
            <div>
              <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800">
                Head-managed
              </span>
              {hasPermission('manage_admins') && <AssignAdminControl queue={queue} />}
            </div>
          )}
        </td>
      )}
      <td className="py-3 pr-4">
        <span className="inline-flex items-center rounded-md bg-subtle px-2 py-1 text-xs font-mono font-semibold text-fg-soft border border-border">
          {queue.tokenPrefix}
        </span>
      </td>
      <td className="py-3 pr-4">
        <StatusBadge status={queue.status} size="sm" />
      </td>
      <td className="py-3 pr-4 text-fg-soft">
        <span>{queue.services.length}</span>
      </td>
      <td className="py-3 pr-4">
        <Link
          to={`/queues/${queue.id}/counters`}
          className="inline-flex items-center gap-1 font-semibold text-brand-fg hover:underline"
          title="Manage counters"
        >
          <span>{queue.counterCount ?? 0}</span>
          <span className="text-xs text-muted font-normal">desks</span>
        </Link>
      </td>
      <td className="py-3 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary: always available, to every role that can see this table */}
          {/* Same size as its neighbours; the primary colour marks it. */}
          <ButtonLink to={`/queues/${queue.id}/live`} variant="primary">
            Open Queue
          </ButtonLink>
          <ButtonLink to={`/queues/${queue.id}`} variant="outline">
            Settings
          </ButtonLink>
          <PermissionGate permission="manage_queues">
            {!queue.deletedAt && canManage && (
              <>
                <Button
                  variant="secondary"
                  loading={updateStatus.isPending}
                  onClick={() => {
                    setRowError(null);
                    updateStatus.mutate(nextStatus, {
                      onError: (err) => setRowError(actionErrorMessage(err)),
                    });
                  }}
                >
                  {updateStatus.isPending
                    ? 'Updating…'
                    : queue.status === 'ACTIVE'
                      ? 'Pause'
                      : 'Resume'}
                </Button>
              </>
            )}
          </PermissionGate>
          {!queue.deletedAt && canDelete && (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </div>
        {rowError && (
          <div className="mt-2">
            <ErrorBanner message={rowError} />
          </div>
        )}
        {confirmingDelete && <DeleteQueueDialog queue={queue} onClose={() => setConfirmingDelete(false)} />}
      </td>
    </tr>
  );
}

/** ADR-069 D8: every deleted queue, who deleted it and why. */
function DeletedQueuesCard({ adminId }: { adminId: string }) {
  const { data: deleted } = useDeletedQueues(adminId || undefined);
  if (!deleted?.length) return null;
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-fg">Deleted queues</h2>
      <ul className="divide-y divide-border text-sm">
        {deleted.map((q) => (
          <li key={q.id} className="py-2.5">
            <p className="font-medium text-fg">{q.name}</p>
            <p className="text-xs text-muted">
              Deleted {formatDateTime(q.deletedAt)}
              {q.deletedByEmail && ` by ${q.deletedByEmail}`}
              {q.deletedByRole && ` (${roleLabel(q.deletedByRole)})`}
              {q.admin && ` · ${q.admin.name}'s workspace`}
            </p>
            {q.deletionReason && <p className="mt-1 text-xs text-fg-soft">Reason: {q.deletionReason}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function QueuesPage() {
  const { hasPermission } = useAuth();
  const organizationWide = hasPermission('view_all_workspaces');
  const [adminFilter, setAdminFilter] = useState('');
  const { data: queues, isLoading } = useQueues(adminFilter || undefined);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QueueStatus | 'ALL'>('ALL');

  // Client-side search is correct here: unlike staff/devices/audit logs, the
  // queue list is not paginated — `useQueues` already holds every queue in the
  // organization, so filtering locally can never hide a match.
  const normalizedSearch = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return (queues ?? []).filter((q) => {
      const matchesSearch =
        !normalizedSearch ||
        q.name.toLowerCase().includes(normalizedSearch) ||
        (q.description?.toLowerCase().includes(normalizedSearch) ?? false) ||
        q.tokenPrefix.toLowerCase().includes(normalizedSearch) ||
        q.services.some((s) => s.serviceName.toLowerCase().includes(normalizedSearch));
      const matchesStatus = statusFilter === 'ALL' || q.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [queues, normalizedSearch, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Queues"
        description="Create and operate digital queues, monitor real-time lines, and configure service counters."
        actions={<CreateQueueButton />}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-md">
          <SearchInput
            value={search}
            onChange={setSearch}
            label="Search queues"
            placeholder="Search by name, prefix, or service…"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {organizationWide && <AdminFilter value={adminFilter} onChange={setAdminFilter} />}
          <label htmlFor="queue-status-filter" className="sr-only">Filter by status</label>
          <select
            id="queue-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as QueueStatus | 'ALL')}
            className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500"
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <Spinner label="Loading queues…" />
        ) : filtered.length === 0 ? (
          normalizedSearch || statusFilter !== 'ALL' ? (
            <EmptyState message="No queues match your search." />
          ) : (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <p className="text-sm text-muted">No queues yet.</p>
              <CreateQueueButton />
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                  <th className="py-3 pr-4">Name</th>
                  {organizationWide && (
                    <th className="py-3 pr-4">
                      <span className="inline-flex items-center">
                        Admin
                        <InfoHelp label="Admin">
                          Each queue belongs to one Admin. A Head-managed queue existed before
                          workspaces and waits for the Organization Head to assign it to an Admin.
                        </InfoHelp>
                      </span>
                    </th>
                  )}
                  <th className="py-3 pr-4">Prefix</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Services</th>
                  <th className="py-3 pr-4">Counters</th>
                  <th className="py-3 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <QueueRow key={q.id} queue={q} showAdmin={organizationWide} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {hasPermission('view_audit_logs') && <DeletedQueuesCard adminId={adminFilter} />}
    </div>
  );
}

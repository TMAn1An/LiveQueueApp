import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCreateQueue, useDeleteQueue, useQueues, useUpdateQueueStatus } from '../hooks/useQueues';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { PageHeader } from '../components/PageHeader';
import { actionErrorMessage } from '../utils/actionError';
import { PermissionGate } from '../components/PermissionGate';
import { SearchInput } from '../components/SearchInput';
import { Switch } from '../components/Switch';
import {
  SERVICE_START_VERIFICATION_HELP,
  SERVICE_START_VERIFICATION_LABEL,
} from '../components/ServiceStartVerificationSetting';
import { ApiError } from '../api/client';
import type { Queue, QueueStatus } from '../types/queue';

function CreateQueueModal({ onClose }: { onClose: () => void }) {
  const createQueue = useCreateQueue();
  const [name, setName] = useState('');
  const [tokenPrefix, setTokenPrefix] = useState('A');
  const [allowMultipleServices, setAllowMultipleServices] = useState(true);
  // ADR-041: on by default — the creator turns it off deliberately.
  const [requireServiceStartOtp, setRequireServiceStartOtp] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    try {
      await createQueue.mutateAsync({
        name,
        tokenPrefix,
        allowMultipleServices,
        requireServiceStartOtp,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create queue.');
    }
  }

  return (
    <Modal title="Create Queue" onClose={onClose}>
      <ErrorBanner message={error} />
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-fg-soft">Queue name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Front Desk, Pharmacy, Billing"
            className="w-full rounded-md border border-border-strong px-3 py-2 text-sm focus:border-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-fg-soft">Token prefix</label>
          <input
            value={tokenPrefix}
            onChange={(e) => setTokenPrefix(e.target.value)}
            maxLength={10}
            placeholder="e.g. A, PH, VIP"
            className="w-full rounded-md border border-border-strong px-3 py-2 text-sm focus:border-brand-500"
          />
          <p className="mt-1 text-xs text-muted">Tokens will be numbered like A001, A002, etc.</p>
        </div>
        <div className="space-y-3 rounded-lg border border-border bg-subtle/50 p-3.5">
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={allowMultipleServices}
              onChange={(e) => setAllowMultipleServices(e.target.checked)}
              className="mt-0.5 rounded border-border-strong text-brand-600 focus:ring-brand-500"
            />
            <span>
              <span className="block font-medium text-fg-soft">Allow multiple services</span>
              <span className="block text-xs text-muted">
                Customers can select more than one service when joining.
              </span>
            </span>
          </label>
          <div className="border-t border-border pt-3">
            <Switch
              id="create-queue-service-start-verification"
              checked={requireServiceStartOtp}
              onChange={setRequireServiceStartOtp}
              label={SERVICE_START_VERIFICATION_LABEL}
              description={SERVICE_START_VERIFICATION_HELP}
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          Customers may join as often as they like. To limit repeat visits, open the queue after
          creating it and set up how customers are identified.
        </p>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name || !tokenPrefix || createQueue.isPending} onClick={() => void handleSubmit()}>
            {createQueue.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function QueueRow({ queue }: { queue: Queue }) {
  const updateStatus = useUpdateQueueStatus(queue.id);
  const deleteQueue = useDeleteQueue();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

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
          <Link to={`/queues/${queue.id}/live`}>
            <Button variant="primary" size="lg">
              Open Queue
            </Button>
          </Link>
          <Link to={`/queues/${queue.id}`}>
            <Button variant="outline">Settings</Button>
          </Link>
          <PermissionGate permission="manage_queues">
            {!queue.deletedAt && (
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
                <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              </>
            )}
          </PermissionGate>
        </div>
        {rowError && (
          <div className="mt-2">
            <ErrorBanner message={rowError} />
          </div>
        )}
        {confirmingDelete && (
          <ConfirmDialog
            title={`Delete queue "${queue.name}"?`}
            message={
              queue.services.length > 0
                ? `This queue has ${queue.services.length} service${queue.services.length === 1 ? '' : 's'} configured. Deleting it cannot be undone.`
                : 'This cannot be undone.'
            }
            confirming={deleteQueue.isPending}
            onConfirm={() =>
              deleteQueue.mutate(queue.id, {
                onSuccess: () => setConfirmingDelete(false),
                onError: (err) => {
                  setConfirmingDelete(false);
                  setRowError(actionErrorMessage(err));
                },
              })
            }
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </td>
    </tr>
  );
}

export function QueuesPage() {
  const { data: queues, isLoading } = useQueues();
  const [showCreate, setShowCreate] = useState(false);
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
        actions={
          <PermissionGate permission="manage_queues">
            <Button size="lg" variant="primary" onClick={() => setShowCreate(true)}>
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              Create Queue
            </Button>
          </PermissionGate>
        }
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
        <div className="flex items-center gap-2">
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
          <EmptyState
            message={
              normalizedSearch || statusFilter !== 'ALL'
                ? 'No queues match your search.'
                : 'No queues found.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                  <th className="py-3 pr-4">Name</th>
                  <th className="py-3 pr-4">Prefix</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Services</th>
                  <th className="py-3 pr-4">Counters</th>
                  <th className="py-3 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <QueueRow key={q.id} queue={q} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showCreate && <CreateQueueModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

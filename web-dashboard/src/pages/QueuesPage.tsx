import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCreateQueue, useDeleteQueue, useQueues, useUpdateQueueStatus } from '../hooks/useQueues';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { ErrorBanner } from '../components/ErrorBanner';
import { PermissionGate } from '../components/PermissionGate';
import { ApiError } from '../api/client';
import type { Queue, QueueStatus } from '../types/queue';

function CreateQueueModal({ onClose }: { onClose: () => void }) {
  const createQueue = useCreateQueue();
  const [name, setName] = useState('');
  const [tokenPrefix, setTokenPrefix] = useState('A');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    try {
      await createQueue.mutateAsync({ name, tokenPrefix });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create queue.');
    }
  }

  return (
    <Modal title="Create Queue" onClose={onClose}>
      <ErrorBanner message={error} />
      <div className="mb-3">
        <label className="mb-1 block text-sm font-medium text-slate-700">Queue name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-slate-700">Token prefix</label>
        <input
          value={tokenPrefix}
          onChange={(e) => setTokenPrefix(e.target.value)}
          maxLength={10}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!name || !tokenPrefix || createQueue.isPending} onClick={() => void handleSubmit()}>
          {createQueue.isPending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </Modal>
  );
}

function QueueRow({ queue }: { queue: Queue }) {
  const updateStatus = useUpdateQueueStatus(queue.id);
  const deleteQueue = useDeleteQueue();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const nextStatus: QueueStatus = queue.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';

  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 pr-4">
        <Link to={`/queues/${queue.id}`} className="font-medium text-blue-600 hover:underline">
          {queue.name}
        </Link>
        {queue.deletedAt && <span className="ml-2 text-xs text-slate-400">(archived)</span>}
      </td>
      <td className="py-2 pr-4">{queue.tokenPrefix}</td>
      <td className="py-2 pr-4">
        <StatusBadge status={queue.status} />
      </td>
      <td className="py-2 pr-4">{queue.services.length}</td>
      <td className="py-2 pr-4">
        <Link to={`/queues/${queue.id}/counters`} className="font-medium text-blue-600 hover:underline">
          {queue.counterCount ?? 0}
        </Link>
      </td>
      <td className="py-2 pr-4">
        <PermissionGate permission="manage_queues">
          {!queue.deletedAt && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => updateStatus.mutate(nextStatus)}>
                {queue.status === 'ACTIVE' ? 'Pause' : 'Resume'}
              </Button>
              {!confirmingDelete ? (
                <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              ) : (
                <>
                  <span className="self-center text-xs text-red-600">
                    {queue.services.length > 0 ? 'Has services — confirm?' : 'Confirm?'}
                  </span>
                  <Button variant="danger" onClick={() => deleteQueue.mutate(queue.id)}>
                    Yes, delete
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          )}
        </PermissionGate>
      </td>
    </tr>
  );
}

export function QueuesPage() {
  const { data: queues, isLoading } = useQueues();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<QueueStatus | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    return (queues ?? []).filter((q) => {
      const matchesSearch = q.name.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'ALL' || q.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [queues, search, statusFilter]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Queues</h1>
        <PermissionGate permission="manage_queues">
          <Button onClick={() => setShowCreate(true)}>Create Queue</Button>
        </PermissionGate>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          placeholder="Search queues…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as QueueStatus | 'ALL')}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <EmptyState message="No queues found." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Prefix</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Services</th>
                <th className="py-2 pr-4">Counters</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <QueueRow key={q.id} queue={q} />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showCreate && <CreateQueueModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

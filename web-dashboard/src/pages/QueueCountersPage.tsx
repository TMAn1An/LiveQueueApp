import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueue } from '../hooks/useQueues';
import {
  useAssignCounter,
  useAssignableStaff,
  useCounters,
  useCreateCounter,
  useDeleteCounter,
  useSetCounterStatus,
  useUpdateCounter,
} from '../hooks/useCounters';
import { useStaffList } from '../hooks/useStaff';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { QueueBreadcrumb } from '../components/QueueBreadcrumb';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState, InlineSpinner } from '../components/Spinner';
import { PermissionGate } from '../components/PermissionGate';
import { useAuth } from '../context/AuthContext';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiError } from '../api/client';
import type { Counter, CounterStatus } from '../types/queue';

const COUNTER_STATUSES: CounterStatus[] = ['ACTIVE', 'ON_BREAK', 'OFFLINE'];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function CounterRow({
  queueId,
  counter,
  onError,
}: {
  queueId: string;
  counter: Counter;
  onError: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const updateCounter = useUpdateCounter(queueId);
  const setStatus = useSetCounterStatus(queueId);
  const assignCounter = useAssignCounter(queueId);
  const deleteCounter = useDeleteCounter(queueId);
  // V2 Product Completion checkpoint, Part B: Delete previously called the
  // mutation directly on click, with no way to back out of a mis-click.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Only staff who could actually take this counter: free ones, plus whoever
  // currently holds it. The backend decides — a client-side filter over the
  // full staff list would go stale the moment another admin assigned someone.
  const canAssign = hasPermission('manage_staff');
  const { data: assignableStaff, isLoading: loadingStaff } = useAssignableStaff(
    counter.id,
    canAssign,
  );
  const { data: staffResult } = useStaffList(1, 100);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(counter.name);

  // Resolved from the full staff list rather than the assignable one, so the
  // name still shows if this person somehow falls out of availability.
  const staffName = staffResult?.data.find((s) => s.id === counter.staffId)?.name ?? '—';

  return (
    <tr className="border-b border-border">
      <td className="py-2 pr-4">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-border-strong px-2 py-1 text-sm"
          />
        ) : (
          counter.name
        )}
      </td>
      <td className="py-2 pr-4">
        <StatusBadge status={counter.status} />
      </td>
      <td className="py-2 pr-4">{staffName}</td>
      <td className="py-2 pr-4">
        <PermissionGate permission="manage_counters">
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button
                  loading={updateCounter.isPending}
                  onClick={() => {
                    onError('');
                    updateCounter.mutate(
                      { counterId: counter.id, name },
                      {
                        // The editor stays open until the rename actually
                        // lands, so a rejected save does not look accepted.
                        onSuccess: () => setEditing(false),
                        onError: (err) => onError(errorMessage(err, 'Failed to rename counter.')),
                      },
                    );
                  }}
                >
                  {updateCounter.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={updateCounter.isPending}
                  onClick={() => {
                    setName(counter.name);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Rename
              </Button>
            )}
            <select
              value={counter.status}
              aria-label="Counter status"
              disabled={setStatus.isPending}
              onChange={(e) => {
                onError('');
                setStatus.mutate(
                  { counterId: counter.id, status: e.target.value as CounterStatus },
                  { onError: (err) => onError(errorMessage(err, 'Failed to change counter status.')) },
                );
              }}
              className="rounded-md border border-border-strong px-2 py-1 text-sm"
            >
              {COUNTER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {/* ADR-036: deciding who stands at a counter is a staffing
                decision reserved to owners and admins. The backend refuses it
                for anyone else regardless — this keeps the control from
                appearing at all rather than failing when used. */}
            <PermissionGate permission="manage_staff">
              <div className="flex items-center gap-1">
                <select
                  value={counter.staffId ?? ''}
                  aria-label="Assigned staff"
                  // Locked while the request is in flight so a second change
                  // cannot race the first, and while options are still loading
                  // so nobody picks from an empty list.
                  disabled={assignCounter.isPending || loadingStaff}
                  onChange={(e) => {
                    onError('');
                    assignCounter.mutate(
                      { counterId: counter.id, staffId: e.target.value || null },
                      {
                        onError: (err) =>
                          onError(errorMessage(err, 'Failed to assign staff to counter.')),
                      },
                    );
                  }}
                  className="rounded-md border border-border-strong px-2 py-1 text-sm"
                >
                  {/* Selecting this clears the assignment, which is what frees
                      the person for every other counter. */}
                  <option value="">Unassigned</option>
                  {(assignableStaff ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {assignCounter.isPending && (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <InlineSpinner />
                    Assigning…
                  </span>
                )}
              </div>
            </PermissionGate>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        </PermissionGate>
        {confirmingDelete && (
          <ConfirmDialog
            title={`Delete counter "${counter.name}"?`}
            message="Staff will no longer be able to serve customers from this counter. This cannot be undone."
            confirming={deleteCounter.isPending}
            onConfirm={() => {
              onError('');
              deleteCounter.mutate(counter.id, {
                onSuccess: () => setConfirmingDelete(false),
                onError: (err) => {
                  setConfirmingDelete(false);
                  onError(errorMessage(err, 'Failed to delete counter.'));
                },
              });
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </td>
    </tr>
  );
}

export function QueueCountersPage() {
  const { queueId } = useParams<{ queueId: string }>();
  const { data: queue } = useQueue(queueId);
  const { data: counters, isLoading } = useCounters(queueId);
  const createCounter = useCreateCounter(queueId ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!queueId) return null;

  return (
    <div>
      <QueueBreadcrumb
        queueId={queueId}
        queueName={queue?.name ?? 'Queue'}
        section="Counters"
        backTo={`/queues/${queueId}`}
        backLabel={`Back to ${queue?.name ?? 'Queue'}`}
      />
      <h1 className="mb-4 text-xl font-semibold text-fg">Counters</h1>

      <ErrorBanner message={error} />

      <Card>
        {isLoading ? (
          <Spinner />
        ) : !counters?.length ? (
          <EmptyState message="No counters yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-faint">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Assigned Staff</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {counters.map((c) => (
                <CounterRow key={c.id} queueId={queueId} counter={c} onError={setError} />
              ))}
            </tbody>
          </table>
        )}

        <PermissionGate permission="manage_counters">
          <div className="mt-4 flex items-end gap-2 border-t border-border pt-4">
            <div>
              <label className="mb-1 block text-xs text-muted">New counter name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-border-strong px-2 py-1 text-sm"
              />
            </div>
            <Button
              disabled={!name}
              loading={createCounter.isPending}
              onClick={() => {
                setError(null);
                createCounter.mutate(name, {
                  // Cleared only once the counter exists — a failed create
                  // must not silently discard what was typed.
                  onSuccess: () => setName(''),
                  onError: (err) => setError(errorMessage(err, 'Failed to create counter.')),
                });
              }}
            >
              {createCounter.isPending ? 'Adding…' : 'Add Counter'}
            </Button>
          </div>
        </PermissionGate>
      </Card>
    </div>
  );
}

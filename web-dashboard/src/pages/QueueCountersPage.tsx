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
import { InfoHelp } from '../components/InfoHelp';
import { Button } from '../components/Button';
import { FieldError } from '../components/FieldError';
import { latinNameError } from '../utils/latinText';
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
  const { hasPermission, staff } = useAuth();
  const updateCounter = useUpdateCounter(queueId);
  const setStatus = useSetCounterStatus(queueId);
  const assignCounter = useAssignCounter(queueId);
  const deleteCounter = useDeleteCounter(queueId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // ADR-064: OWNER/ADMIN manage every counter and who stands at it. STAFF
  // only see the list, with their own counter marked — no controls at all.
  const canAssign = hasPermission('manage_staff');
  const isMine = Boolean(staff && counter.staffId === staff.id);
  const { data: assignableStaff, isLoading: loadingStaff } = useAssignableStaff(
    counter.id,
    canAssign,
  );
  const { data: staffResult } = useStaffList(1, 100);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(counter.name);
  const nameError = latinNameError(name);

  const staffName = staffResult?.data.find((s) => s.id === counter.staffId)?.name ?? '—';

  return (
    <tr className="border-b border-border transition-colors hover:bg-subtle/50">
      <td className="py-3 pr-4 font-semibold text-fg">
        {editing ? (
          <div>
            <input
              value={name}
              aria-label="Counter name"
              aria-invalid={nameError ? true : undefined}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-md border border-border-strong px-3 text-sm bg-surface text-fg focus:border-brand-500"
            />
            <FieldError message={nameError} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-brand-500" />
            <span>{counter.name}</span>
            {isMine && (
              <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-bold text-brand-fg ring-1 ring-brand-200 dark:bg-brand-950/60 dark:ring-brand-800">
                Your counter
              </span>
            )}
          </div>
        )}
      </td>
      <td className="py-3 pr-4">
        <StatusBadge status={counter.status} size="sm" />
      </td>
      <td className="py-3 pr-4 text-sm text-fg-soft font-medium">
        {staffName !== '—' ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-subtle px-2 py-0.5 text-xs text-fg">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {staffName}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className="py-3 pr-4">
        <PermissionGate permission="manage_counters">
          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button
                  loading={updateCounter.isPending}
                  disabled={!name.trim() || Boolean(nameError)}
                  onClick={() => {
                    onError('');
                    updateCounter.mutate(
                      { counterId: counter.id, name },
                      {
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
              className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-fg focus:border-brand-500"
            >
              {COUNTER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <PermissionGate permission="manage_staff">
              <div className="flex items-center gap-1">
                <select
                  value={counter.staffId ?? ''}
                  aria-label="Assigned staff"
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
                  className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-fg focus:border-brand-500"
                >
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
            message="Nobody will be able to serve people from this counter, and whoever is assigned to it is unassigned. This cannot be undone."
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
  const newNameError = latinNameError(name);

  if (!queueId) return null;

  return (
    <div className="space-y-6">
      <div>
        <QueueBreadcrumb
          queueId={queueId}
          queueName={queue?.name ?? 'Queue'}
          section="Counters"
          backTo={`/queues/${queueId}`}
          backLabel={`Back to ${queue?.name ?? 'Queue'}`}
        />
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">Counters</h1>
          <InfoHelp label="Counters">
            Desks and service points where staff serve people for this queue. The owner or an
            admin creates and opens counters and assigns each staff member to one; staff serve
            only from their own.
          </InfoHelp>
        </div>
      </div>

      <ErrorBanner message={error} />

      <Card>
        {isLoading ? (
          <Spinner label="Loading counters…" />
        ) : !counters?.length ? (
          <EmptyState message="No counters yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                  <th className="py-3 pr-4">Name</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Assigned Staff</th>
                  <th className="py-3 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {counters.map((c) => (
                  <CounterRow key={c.id} queueId={queueId} counter={c} onError={setError} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <PermissionGate permission="manage_counters">
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Add Service Counter
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:max-w-xs">
                <label htmlFor="new-counter-name" className="mb-1 block text-xs text-muted">New counter name</label>
                <input
                  id="new-counter-name"
                  value={name}
                  aria-invalid={newNameError ? true : undefined}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Counter 1, Window A"
                  className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
                />
              </div>
              <Button
                disabled={!name.trim() || Boolean(newNameError)}
                loading={createCounter.isPending}
                onClick={() => {
                  setError(null);
                  createCounter.mutate(name, {
                    onSuccess: () => setName(''),
                    onError: (err) => setError(errorMessage(err, 'Failed to create counter.')),
                  });
                }}
              >
                {createCounter.isPending ? 'Adding…' : 'Add Counter'}
              </Button>
            </div>
            <FieldError message={newNameError} />
          </div>
        </PermissionGate>
      </Card>
    </div>
  );
}

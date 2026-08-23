import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueue } from '../hooks/useQueues';
import {
  useAssignCounter,
  useCounters,
  useCreateCounter,
  useDeleteCounter,
  useSetCounterStatus,
  useUpdateCounter,
} from '../hooks/useCounters';
import { useStaffList } from '../hooks/useStaff';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { PermissionGate } from '../components/PermissionGate';
import type { Counter, CounterStatus } from '../types/queue';

const COUNTER_STATUSES: CounterStatus[] = ['ACTIVE', 'ON_BREAK', 'OFFLINE'];

function CounterRow({ queueId, counter }: { queueId: string; counter: Counter }) {
  const updateCounter = useUpdateCounter(queueId);
  const setStatus = useSetCounterStatus(queueId);
  const assignCounter = useAssignCounter(queueId);
  const deleteCounter = useDeleteCounter(queueId);
  const { data: staffResult } = useStaffList(1, 100);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(counter.name);

  const staffName = staffResult?.data.find((s) => s.id === counter.staffId)?.name ?? '—';

  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 pr-4">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
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
                  onClick={() => {
                    updateCounter.mutate({ counterId: counter.id, name });
                    setEditing(false);
                  }}
                >
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
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
              onChange={(e) =>
                setStatus.mutate({ counterId: counter.id, status: e.target.value as CounterStatus })
              }
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              {COUNTER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={counter.staffId ?? ''}
              onChange={(e) =>
                e.target.value &&
                assignCounter.mutate({ counterId: counter.id, staffId: e.target.value })
              }
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="" disabled>
                Assign staff…
              </option>
              {(staffResult?.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button variant="danger" onClick={() => deleteCounter.mutate(counter.id)}>
              Delete
            </Button>
          </div>
        </PermissionGate>
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

  if (!queueId) return null;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Link to={`/queues/${queueId}`} className="text-sm text-blue-600 hover:underline">
          ← {queue?.name ?? 'Queue'}
        </Link>
      </div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Counters</h1>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : !counters?.length ? (
          <EmptyState message="No counters yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Assigned Staff</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {counters.map((c) => (
                <CounterRow key={c.id} queueId={queueId} counter={c} />
              ))}
            </tbody>
          </table>
        )}

        <PermissionGate permission="manage_counters">
          <div className="mt-4 flex items-end gap-2 border-t border-slate-100 pt-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">New counter name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <Button
              disabled={!name || createCounter.isPending}
              onClick={() => {
                createCounter.mutate(name);
                setName('');
              }}
            >
              Add Counter
            </Button>
          </div>
        </PermissionGate>
      </Card>
    </div>
  );
}

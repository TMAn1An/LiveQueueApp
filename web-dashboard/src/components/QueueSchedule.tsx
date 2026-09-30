import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUpdateQueue } from '../hooks/useQueues';
import {
  useCreateQueueSession,
  useDeleteQueueSession,
  useQueueSessions,
  useUpdateQueueSession,
} from '../hooks/useQueueSchedule';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorBanner } from './ErrorBanner';
import { Switch } from './Switch';
import { EmptyState } from './Spinner';
import { PermissionGate } from './PermissionGate';
import { ApiError } from '../api/client';
import type { QueueSessionInput } from '../api/queueSchedule.api';
import type { Queue, QueueSession } from '../types/queue';

/**
 * Phase 4: optional weekly schedule + session capacity. Off by default
 * (queue.scheduleEnabled) — every queue keeps accepting joins at any time
 * until an administrator turns this on, exactly as before this feature
 * existed.
 *
 * A weekday with no sessions is simply closed — there is no separate
 * open/closed flag to keep in sync with the list below. Two sessions on the
 * same day are allowed to overlap on purpose (two concurrent capacity
 * pools) — this editor does not warn about it.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function minutesToTimeInput(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function timeInputToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatRange(startMinute: number, endMinute: number): string {
  return `${minutesToTimeInput(startMinute)}–${minutesToTimeInput(endMinute)}`;
}

function SessionRow({
  queueId,
  session,
  canEdit,
}: {
  queueId: string;
  session: QueueSession;
  canEdit: boolean;
}) {
  const updateSession = useUpdateQueueSession(queueId);
  const deleteSession = useDeleteQueueSession(queueId);
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(minutesToTimeInput(session.startMinute));
  const [end, setEnd] = useState(minutesToTimeInput(session.endMinute));
  const [capacity, setCapacity] = useState(session.capacity != null ? String(session.capacity) : '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startMinute = timeInputToMinutes(start);
  const endMinute = timeInputToMinutes(end);
  const parsedCapacity = capacity.trim() === '' ? null : Number(capacity);
  const capacityValid =
    parsedCapacity === null || (Number.isInteger(parsedCapacity) && parsedCapacity >= 1);
  const timeValid = startMinute !== null && endMinute !== null && endMinute > startMinute;

  async function save() {
    if (!timeValid || !capacityValid) return;
    setError(null);
    try {
      const input: QueueSessionInput = {
        weekday: session.weekday,
        startMinute: startMinute!,
        endMinute: endMinute!,
        capacity: parsedCapacity,
      };
      await updateSession.mutateAsync({ sessionId: session.id, input });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this session.');
    }
  }

  if (editing) {
    return (
      <tr className="border-b border-border">
        <td className="py-2 pr-4" colSpan={2}>
          <div className="flex items-center gap-2">
            <input
              aria-label="Start time"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-md border border-border-strong px-2 py-1 text-sm"
            />
            <span className="text-muted">–</span>
            <input
              aria-label="End time"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="rounded-md border border-border-strong px-2 py-1 text-sm"
            />
          </div>
          {error && <ErrorBanner message={error} />}
        </td>
        <td className="py-2 pr-4">
          <input
            aria-label="Session capacity"
            type="number"
            min={1}
            placeholder="Unlimited"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="w-24 rounded-md border border-border-strong px-2 py-1 text-sm"
          />
        </td>
        <td className="py-2 pr-4">
          <div className="flex gap-2">
            <Button
              loading={updateSession.isPending}
              disabled={!timeValid || !capacityValid}
              onClick={() => void save()}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border">
      <td className="py-2 pr-4" colSpan={2}>
        {formatRange(session.startMinute, session.endMinute)}
      </td>
      <td className="py-2 pr-4">{session.capacity != null ? session.capacity : 'Unlimited'}</td>
      <td className="py-2 pr-4">
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Remove
            </Button>
          </div>
        )}
        {confirmingDelete && (
          <ConfirmDialog
            title={`Remove the ${formatRange(session.startMinute, session.endMinute)} session?`}
            message="Customers already assigned to it keep their original time — only future joins are affected. This cannot be undone."
            confirming={deleteSession.isPending}
            onConfirm={() =>
              deleteSession.mutate(session.id, {
                onSuccess: () => setConfirmingDelete(false),
                onError: (err) => {
                  setConfirmingDelete(false);
                  setDeleteError(err instanceof ApiError ? err.message : 'Could not remove this session.');
                },
              })
            }
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
        {deleteError && <ErrorBanner message={deleteError} />}
      </td>
    </tr>
  );
}

function AddSessionRow({
  queueId,
  weekday,
}: {
  queueId: string;
  weekday: number;
}) {
  const createSession = useCreateQueueSession(queueId);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [capacity, setCapacity] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startMinute = timeInputToMinutes(start);
  const endMinute = timeInputToMinutes(end);
  const parsedCapacity = capacity.trim() === '' ? null : Number(capacity);
  const capacityValid =
    parsedCapacity === null || (Number.isInteger(parsedCapacity) && parsedCapacity >= 1);
  const timeValid = startMinute !== null && endMinute !== null && endMinute > startMinute;

  async function add() {
    if (!timeValid || !capacityValid) return;
    setError(null);
    try {
      await createSession.mutateAsync({
        weekday,
        startMinute: startMinute!,
        endMinute: endMinute!,
        capacity: parsedCapacity,
      });
      setCapacity('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this session.');
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-muted">Start</label>
        <input
          aria-label={`New ${WEEKDAY_NAMES[weekday]} session start time`}
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="rounded-md border border-border-strong px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted">End</label>
        <input
          aria-label={`New ${WEEKDAY_NAMES[weekday]} session end time`}
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="rounded-md border border-border-strong px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted">Capacity</label>
        <input
          aria-label={`New ${WEEKDAY_NAMES[weekday]} session capacity`}
          type="number"
          min={1}
          placeholder="Unlimited"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          className="w-24 rounded-md border border-border-strong px-2 py-1 text-sm"
        />
      </div>
      <Button
        loading={createSession.isPending}
        disabled={!timeValid || !capacityValid}
        onClick={() => void add()}
      >
        Add session
      </Button>
      {error && <ErrorBanner message={error} />}
    </div>
  );
}

export function QueueSchedule({ queue }: { queue: Queue }) {
  const { hasPermission } = useAuth();
  const updateQueue = useUpdateQueue(queue.id);
  const { data: sessions, isLoading } = useQueueSessions(queue.id);
  const [dailyCapacity, setDailyCapacity] = useState(
    queue.scheduleDailyCapacity != null ? String(queue.scheduleDailyCapacity) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const canEdit = hasPermission('manage_queues') && !queue.deletedAt;

  async function toggleEnabled(next: boolean) {
    setError(null);
    try {
      await updateQueue.mutateAsync({ scheduleEnabled: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this setting.');
    }
  }

  async function toggleVisible(next: boolean) {
    setError(null);
    try {
      await updateQueue.mutateAsync({ scheduleVisibleToCustomers: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this setting.');
    }
  }

  const parsedDailyCapacity = dailyCapacity.trim() === '' ? null : Number(dailyCapacity);
  const dailyCapacityValid =
    parsedDailyCapacity === null || (Number.isInteger(parsedDailyCapacity) && parsedDailyCapacity >= 1);
  const dailyCapacityDirty = parsedDailyCapacity !== (queue.scheduleDailyCapacity ?? null);

  async function saveDailyCapacity() {
    if (!dailyCapacityValid) return;
    setError(null);
    try {
      await updateQueue.mutateAsync({ scheduleDailyCapacity: parsedDailyCapacity });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the daily capacity.');
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <Switch
        id={`schedule-enabled-${queue.id}`}
        checked={queue.scheduleEnabled}
        onChange={(next) => void toggleEnabled(next)}
        disabled={!canEdit || updateQueue.isPending}
        label="Restrict this queue to a weekly schedule"
        description="Off: customers may join at any time, exactly as today."
      />

      {queue.scheduleEnabled && (
        <div className="space-y-4 border-l-2 border-border pl-4">
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted" htmlFor="schedule-daily-capacity">
                Daily capacity (all sessions combined)
              </label>
              <input
                id="schedule-daily-capacity"
                type="number"
                min={1}
                placeholder="Unlimited"
                value={dailyCapacity}
                onChange={(e) => setDailyCapacity(e.target.value)}
                disabled={!canEdit}
                className="w-32 rounded-md border border-border-strong px-2 py-1.5 text-sm"
              />
            </div>
            {canEdit && dailyCapacityDirty && (
              <Button
                loading={updateQueue.isPending}
                disabled={!dailyCapacityValid}
                onClick={() => void saveDailyCapacity()}
              >
                Save
              </Button>
            )}
          </div>

          <Switch
            id={`schedule-visible-${queue.id}`}
            checked={queue.scheduleVisibleToCustomers}
            onChange={(next) => void toggleVisible(next)}
            disabled={!canEdit || updateQueue.isPending}
            label="Show today's hours to customers"
            description="Off: the app still explains why a join failed, just not the full schedule."
          />

          <p className="text-sm text-muted">
            A customer who joins while the current session is full, between sessions, or before the
            first session is placed in the next session today that has room, and joins the line when
            that session starts — they cannot be called earlier. Once today&apos;s last session has
            ended, or every remaining session is full, new joins are refused.
          </p>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-fg-soft">Sessions</h3>
            {isLoading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              WEEKDAY_NAMES.map((dayName, weekday) => {
                const daySessions = (sessions ?? [])
                  .filter((s) => s.weekday === weekday)
                  .sort((a, b) => a.startMinute - b.startMinute);
                return (
                  <div key={weekday} className="mb-4">
                    <p className="text-sm font-medium text-fg-soft">{dayName}</p>
                    {daySessions.length === 0 ? (
                      <EmptyState message="Closed" />
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {daySessions.map((session) => (
                            <SessionRow
                              key={session.id}
                              queueId={queue.id}
                              session={session}
                              canEdit={canEdit}
                            />
                          ))}
                        </tbody>
                      </table>
                    )}
                    <PermissionGate permission="manage_queues">
                      <AddSessionRow queueId={queue.id} weekday={weekday} />
                    </PermissionGate>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

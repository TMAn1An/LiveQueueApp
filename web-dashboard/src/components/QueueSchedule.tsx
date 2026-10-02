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
import { InfoHelp } from './InfoHelp';
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
 * open/closed flag to keep in sync with the list below. Sessions on the same
 * day may not overlap (back-to-back is fine): this editor flags an overlap
 * before saving, and the backend refuses one regardless (SESSION_OVERLAP).
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LAST_MINUTE = 23 * 60 + 59;
const DEFAULT_NEW_SESSION_MINUTES = 3 * 60;

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

type Window = { startMinute: number; endMinute: number };

/** Half-open [start, end), matching the backend: touching is not overlapping. */
function findOverlap(candidate: Window, others: Window[]): Window | undefined {
  return others.find((o) => candidate.startMinute < o.endMinute && o.startMinute < candidate.endMinute);
}

/** The shared validation for a session being added or edited. */
function useSessionDraft(initial: { start: string; end: string; capacity: string }, others: Window[]) {
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [capacity, setCapacity] = useState(initial.capacity);

  const startMinute = timeInputToMinutes(start);
  const endMinute = timeInputToMinutes(end);
  const parsedCapacity = capacity.trim() === '' ? null : Number(capacity);
  const capacityValid = parsedCapacity === null || (Number.isInteger(parsedCapacity) && parsedCapacity >= 1);
  const timeValid = startMinute !== null && endMinute !== null && endMinute > startMinute;
  const clash = timeValid ? findOverlap({ startMinute: startMinute!, endMinute: endMinute! }, others) : undefined;

  let problem: string | null = null;
  if (startMinute !== null && endMinute !== null && endMinute <= startMinute) {
    problem = 'The session must end after it starts.';
  } else if (clash) {
    problem = `Overlaps the ${formatRange(clash.startMinute, clash.endMinute)} session.`;
  } else if (!capacityValid) {
    problem = 'Capacity must be a whole number of 1 or more, or empty for unlimited.';
  }

  return {
    start,
    end,
    capacity,
    setStart,
    setEnd,
    setCapacity,
    problem,
    valid: timeValid && capacityValid && !clash,
    input: { startMinute: startMinute ?? 0, endMinute: endMinute ?? 0, capacity: parsedCapacity },
  };
}

const timeInputClass = 'h-9 rounded-md border border-border-strong bg-surface px-2 text-sm text-fg';

function SessionTimeFields({
  draft,
  label,
}: {
  draft: ReturnType<typeof useSessionDraft>;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        aria-label={`${label} start time`}
        type="time"
        value={draft.start}
        onChange={(e) => draft.setStart(e.target.value)}
        className={timeInputClass}
      />
      <span className="text-muted">–</span>
      <input
        aria-label={`${label} end time`}
        type="time"
        value={draft.end}
        onChange={(e) => draft.setEnd(e.target.value)}
        className={timeInputClass}
      />
      <input
        aria-label={`${label} capacity`}
        type="number"
        min={1}
        placeholder="Unlimited"
        value={draft.capacity}
        onChange={(e) => draft.setCapacity(e.target.value)}
        className={`${timeInputClass} w-24`}
      />
    </div>
  );
}

function SessionRow({
  queueId,
  session,
  others,
  canEdit,
}: {
  queueId: string;
  session: QueueSession;
  /** The same day's other sessions — what this one may not overlap. */
  others: Window[];
  canEdit: boolean;
}) {
  const updateSession = useUpdateQueueSession(queueId);
  const deleteSession = useDeleteQueueSession(queueId);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = useSessionDraft(
    {
      start: minutesToTimeInput(session.startMinute),
      end: minutesToTimeInput(session.endMinute),
      capacity: session.capacity != null ? String(session.capacity) : '',
    },
    others,
  );

  async function save() {
    if (!draft.valid) return;
    setError(null);
    try {
      const input: QueueSessionInput = { weekday: session.weekday, ...draft.input };
      await updateSession.mutateAsync({ sessionId: session.id, input });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this session.');
    }
  }

  if (editing) {
    return (
      <li className="space-y-2 border-b border-border py-2.5 last:border-b-0">
        <SessionTimeFields draft={draft} label={`${WEEKDAY_NAMES[session.weekday]} session`} />
        {draft.problem && <p className="text-xs text-red-700 dark:text-red-400">{draft.problem}</p>}
        {error && <ErrorBanner message={error} />}
        <div className="flex gap-2">
          <Button loading={updateSession.isPending} disabled={!draft.valid} onClick={() => void save()}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">{formatRange(session.startMinute, session.endMinute)}</p>
        <p className="text-xs text-muted">
          {session.capacity != null ? `Capacity ${session.capacity}` : 'Unlimited capacity'}
        </p>
      </div>
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
      {deleteError && (
        <div className="w-full">
          <ErrorBanner message={deleteError} />
        </div>
      )}
    </li>
  );
}

/** A new session starts where the day's last one ends, so the suggested
 * window never overlaps; an empty day suggests ordinary working hours. */
function suggestedWindow(daySessions: Window[]): { start: string; end: string } {
  const lastEnd = daySessions.reduce((max, s) => Math.max(max, s.endMinute), -1);
  if (lastEnd < 0) return { start: '09:00', end: '17:00' };
  const start = Math.min(lastEnd, LAST_MINUTE - 1);
  return {
    start: minutesToTimeInput(start),
    end: minutesToTimeInput(Math.min(start + DEFAULT_NEW_SESSION_MINUTES, LAST_MINUTE)),
  };
}

function AddSessionRow({
  queueId,
  weekday,
  daySessions,
}: {
  queueId: string;
  weekday: number;
  daySessions: Window[];
}) {
  const createSession = useCreateQueueSession(queueId);
  const [error, setError] = useState<string | null>(null);
  const draft = useSessionDraft({ ...suggestedWindow(daySessions), capacity: '' }, daySessions);

  async function add() {
    if (!draft.valid) return;
    setError(null);
    try {
      await createSession.mutateAsync({ weekday, ...draft.input });
      const next = suggestedWindow([...daySessions, draft.input]);
      draft.setStart(next.start);
      draft.setEnd(next.end);
      draft.setCapacity('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this session.');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SessionTimeFields draft={draft} label={`New ${WEEKDAY_NAMES[weekday]} session`} />
        <Button loading={createSession.isPending} disabled={!draft.valid} onClick={() => void add()}>
          Add session
        </Button>
      </div>
      {draft.problem && <p className="text-xs text-red-700 dark:text-red-400">{draft.problem}</p>}
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
        help="Off: customers may join at any time, exactly as today."
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
                className="h-9 w-32 rounded-md border border-border-strong px-3 text-sm"
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
            help="Off: the app still explains why a join failed, just not the full schedule."
          />

          <div>
            <div className="mb-2 flex items-center gap-0.5">
              <h3 className="text-sm font-semibold text-fg-soft">Sessions</h3>
              <InfoHelp label="how customers are placed in sessions">
                A customer who joins while the current session is full, between sessions, or before
                the first session is placed in the next session today that has room, and joins the
                line when that session starts — they cannot be called earlier. Once today&apos;s
                last session has ended, or every remaining session is full, new joins are refused.
              </InfoHelp>
            </div>
            {isLoading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              // Two or three days side by side: each day is short, and one
              // long column left most of the page empty.
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {WEEKDAY_NAMES.map((dayName, weekday) => {
                  const daySessions = (sessions ?? [])
                    .filter((s) => s.weekday === weekday)
                    .sort((a, b) => a.startMinute - b.startMinute);
                  const isOpen = daySessions.length > 0;
                  return (
                    <div key={weekday} className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-2xs">
                      <div className="mb-2 flex items-center justify-between border-b border-border pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${isOpen ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
                          <p className="text-sm font-bold text-fg">{dayName}</p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            isOpen
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-subtle text-muted'
                          }`}
                        >
                          {isOpen ? `${daySessions.length} ${daySessions.length === 1 ? 'session' : 'sessions'}` : 'Closed'}
                        </span>
                      </div>
                      {isOpen ? (
                        <ul className="flex-1">
                          {daySessions.map((session) => (
                            <SessionRow
                              key={session.id}
                              queueId={queue.id}
                              session={session}
                              others={daySessions.filter((s) => s.id !== session.id)}
                              canEdit={canEdit}
                            />
                          ))}
                        </ul>
                      ) : (
                        <p className="flex-1 py-2 text-sm text-muted">No sessions — closed all day.</p>
                      )}
                      <PermissionGate permission="manage_queues">
                        <div className="mt-3 border-t border-border pt-3">
                          <AddSessionRow queueId={queue.id} weekday={weekday} daySessions={daySessions} />
                        </div>
                      </PermissionGate>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

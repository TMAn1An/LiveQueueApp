import { useMemo, useState } from 'react';
import { useUpdateQueue } from '../hooks/useQueues';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PermissionGate } from '../components/PermissionGate';
import { ApiError } from '../api/client';
import { browserTimezone, supportedTimezones } from '../utils/timezone';
import type { Queue } from '../types/queue';

/**
 * The queue's clock (ADR-035).
 *
 * Deliberately here, under the queue's own settings, rather than inside the
 * repeat-visit form where it used to live: a timezone is a fact about where
 * the queue runs, not a property of one policy, and it is also what the
 * customer app uses to show queue-local times.
 *
 * It is normally never touched. A new organization gets its zone from the
 * browser of whoever registered it, and every queue inherits that. This
 * screen exists for the case that inheritance gets wrong — a branch in
 * another region, or an administrator who set the organization up while
 * travelling.
 */
export function QueueTimezoneSetting({
  queue,
  organizationTimezone,
}: {
  queue: Queue;
  organizationTimezone: string | null;
}) {
  const updateQueue = useUpdateQueue(queue.id);
  const zones = useMemo(() => supportedTimezones(), []);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(queue.timezone ?? '');
  const [error, setError] = useState<string | null>(null);

  const effective = queue.timezone ?? organizationTimezone;
  const inherited = !queue.timezone && Boolean(organizationTimezone);

  async function save(next: string | null) {
    setError(null);
    try {
      await updateQueue.mutateAsync({ timezone: next });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the timezone.');
    }
  }

  if (!editing) {
    return (
      <div className="space-y-2 text-sm">
        <ErrorBanner message={error} />
        {effective ? (
          <div>
            <p className="font-medium text-fg-soft">{effective}</p>
            <p className="text-xs text-muted">
              {inherited
                ? 'Inherited from your organization’s timezone.'
                : 'Set for this queue specifically.'}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-fg-soft">No timezone set.</p>
            <p className="text-xs text-muted">
              Needed only for a monthly or yearly repeat limit, a fixed cutoff date, and showing
              queue-local times to customers.
            </p>
          </div>
        )}
        {!queue.deletedAt && (
          <PermissionGate permission="manage_queues">
            <Button
              variant="secondary"
              onClick={() => {
                // Pre-fill with something sensible: this queue's own value,
                // then what it inherits, then this computer's — which is only
                // ever a suggestion, and is labelled as one.
                setValue(queue.timezone ?? organizationTimezone ?? browserTimezone() ?? '');
                setEditing(true);
              }}
            >
              {effective ? 'Change' : 'Set timezone'}
            </Button>
          </PermissionGate>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <ErrorBanner message={error} />
      <div>
        <label className="mb-1 block text-xs text-muted" htmlFor="queue-timezone">
          This queue runs in
        </label>
        {zones ? (
          <select
            id="queue-timezone"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
          >
            <option value="">Use my organization’s timezone</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="queue-timezone"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Asia/Dhaka"
            className="w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
          />
        )}
        <p className="mt-1 text-xs text-muted">
          Leave this on your organization’s timezone unless this queue is somewhere else.
          {browserTimezone() ? ` This computer is set to ${browserTimezone()}.` : ''}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          loading={updateQueue.isPending}
          disabled={updateQueue.isPending}
          onClick={() => void save(value.trim() || null)}
        >
          {updateQueue.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" disabled={updateQueue.isPending} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

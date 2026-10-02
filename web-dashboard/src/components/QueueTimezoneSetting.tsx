import { useMemo, useState } from 'react';
import { useUpdateQueue } from '../hooks/useQueues';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { InfoHelp } from '../components/InfoHelp';
import { PermissionGate } from '../components/PermissionGate';
import { ApiError } from '../api/client';
import { browserTimezone, supportedTimezones, timezoneOptions } from '../utils/timezone';
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
  // The zone of the device being used right now — i.e. where it is. Offered
  // as a one-click choice, never applied silently: a queue's clock must stay
  // the same whoever happens to open settings from wherever they are.
  const deviceZone = browserTimezone();
  const canUseDeviceZone = Boolean(deviceZone) && deviceZone !== effective;

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
            <p className="inline-flex items-center text-fg-soft">
              No timezone set.
              <InfoHelp label="when a timezone is needed">
                Needed only for a monthly or yearly repeat limit, a fixed cutoff date, and showing
                queue-local times to customers.
              </InfoHelp>
            </p>
          </div>
        )}
        {!queue.deletedAt && (
          <PermissionGate permission="manage_queues">
            <div className="flex flex-wrap gap-2">
              {canUseDeviceZone && (
                <Button
                  variant="primary"
                  loading={updateQueue.isPending}
                  onClick={() => void save(deviceZone ?? null)}
                >
                  Use this device’s timezone ({deviceZone})
                </Button>
              )}
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
                {effective ? 'Change' : 'Choose manually'}
              </Button>
            </div>
          </PermissionGate>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <ErrorBanner message={error} />
      <div>
        <div className="mb-1 flex items-center gap-0.5">
          <label className="block text-xs text-muted" htmlFor="queue-timezone">
            This queue runs in
          </label>
          <InfoHelp label="the queue timezone">
            Leave this on your organization’s timezone unless this queue is somewhere else.
          </InfoHelp>
        </div>
        {zones ? (
          <select
            id="queue-timezone"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full h-9 rounded-md border border-border-strong px-3 text-sm"
          >
            <option value="">Use my organization’s timezone</option>
            {timezoneOptions(zones, queue.timezone, organizationTimezone, deviceZone).map((zone) => (
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
            className="w-full h-9 rounded-md border border-border-strong px-3 text-sm"
          />
        )}
        {deviceZone && value !== deviceZone && (
          <button
            type="button"
            onClick={() => setValue(deviceZone)}
            className="mt-1 text-xs font-medium text-brand-fg hover:underline"
          >
            Detect from this device ({deviceZone})
          </button>
        )}
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

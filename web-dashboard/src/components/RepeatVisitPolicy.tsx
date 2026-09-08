import { useMemo, useState } from 'react';
import { useFormFields } from '../hooks/useFormFields';
import { useUpdateQueue } from '../hooks/useQueues';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PermissionGate } from '../components/PermissionGate';
import { ApiError } from '../api/client';
import { IDENTITY_FIELD_TYPES } from '../types/queue';
import type { Queue, RepeatIdentityMode, RepeatRestrictionPeriod } from '../types/queue';

/**
 * How often a customer may use this queue, and — the part that actually
 * makes the limit hold — who the queue counts as one customer (ADR-034).
 *
 * Kept out of the Details editor above it because it is not an independent
 * checkbox any more: it depends on this queue's form questions, so it has to
 * read them, and it can be invalid in ways a single toggle cannot express.
 */

const PERIOD_LABELS: Record<RepeatRestrictionPeriod, string> = {
  ONCE_EVER: 'Once only, ever',
  DAILY: 'Once per day',
  WEEKLY: 'Once per week',
  MONTHLY: 'Once per month',
};

const MODE_LABELS: Record<RepeatIdentityMode, string> = {
  CUSTOM_FIELD: 'An identifier they enter (for example a national ID)',
  VERIFIED_PHONE: 'A phone number they verify by SMS',
  VERIFIED_PHONE_AND_CUSTOM_FIELD: 'Both a verified phone number and an identifier',
};

function needsField(mode: RepeatIdentityMode): boolean {
  return mode === 'CUSTOM_FIELD' || mode === 'VERIFIED_PHONE_AND_CUSTOM_FIELD';
}

function needsPhone(mode: RepeatIdentityMode): boolean {
  return mode === 'VERIFIED_PHONE' || mode === 'VERIFIED_PHONE_AND_CUSTOM_FIELD';
}

/** The browser's own tz database when it exposes one, so nobody has to type
 * an IANA name from memory. Older engines fall back to a plain text box
 * rather than to a guessed default — which timezone a queue runs in is the
 * operator's answer to give, not ours. */
function useTimezoneOptions(): string[] | null {
  return useMemo(() => {
    const supported = (
      Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    if (typeof supported !== 'function') return null;
    try {
      return supported('timeZone');
    } catch {
      return null;
    }
  }, []);
}

const inputClass = 'w-full rounded-md border border-border-strong px-2 py-1.5 text-sm';

export function RepeatVisitPolicy({ queue }: { queue: Queue }) {
  const { data: formFields } = useFormFields(queue.id);
  const updateQueue = useUpdateQueue(queue.id);
  const timezoneOptions = useTimezoneOptions();

  const [editing, setEditing] = useState(false);
  const [restricted, setRestricted] = useState(!queue.allowRepeatVisits);
  const [period, setPeriod] = useState<RepeatRestrictionPeriod>(
    queue.repeatRestrictionPeriod ?? 'ONCE_EVER',
  );
  const [mode, setMode] = useState<RepeatIdentityMode>(queue.repeatIdentityMode ?? 'CUSTOM_FIELD');
  const [fieldKey, setFieldKey] = useState(queue.repeatIdentityFieldKey ?? '');
  const [timezone, setTimezone] = useState(queue.timezone ?? '');
  const [error, setError] = useState<string | null>(null);

  /* Only questions that can actually tell two people apart, and only
     required ones — an optional identity question would let anyone skip the
     limit by leaving it blank. The backend enforces exactly this; offering
     anything else here would just produce a rejected save. */
  const eligibleFields = (formFields?.fields ?? []).filter(
    (field) => IDENTITY_FIELD_TYPES.includes(field.type) && field.required,
  );
  const identityField = (formFields?.fields ?? []).find(
    (field) => field.key === queue.repeatIdentityFieldKey,
  );

  // A queue restricted before this feature existed: the limit is on, but
  // nothing identifies the customer, so joins are refused until someone
  // chooses how. Saying so plainly is the whole point — the old rule it was
  // configured under is not silently still running.
  const configurationRequired = !queue.allowRepeatVisits && !queue.repeatIdentityMode;

  function startEditing() {
    setRestricted(!queue.allowRepeatVisits);
    setPeriod(queue.repeatRestrictionPeriod ?? 'ONCE_EVER');
    setMode(queue.repeatIdentityMode ?? 'CUSTOM_FIELD');
    setFieldKey(queue.repeatIdentityFieldKey ?? eligibleFields[0]?.key ?? '');
    setTimezone(queue.timezone ?? '');
    setError(null);
    setEditing(true);
  }

  const missingField = restricted && needsField(mode) && !fieldKey;
  const missingTimezone = restricted && period !== 'ONCE_EVER' && !timezone;

  async function save() {
    setError(null);
    try {
      await updateQueue.mutateAsync(
        restricted
          ? {
              allowRepeatVisits: false,
              repeatRestrictionPeriod: period,
              repeatIdentityMode: mode,
              repeatIdentityFieldKey: needsField(mode) ? fieldKey : null,
              timezone: period === 'ONCE_EVER' ? null : timezone,
            }
          : { allowRepeatVisits: true },
      );
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the repeat-visit settings.');
    }
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        {configurationRequired && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">This queue is not accepting customers.</p>
            <p className="mt-1">
              It limits repeat visits but does not yet say how customers are identified. Until you
              choose an identity method below, joins are refused — the previous rule recognised the
              customer's phone app, which meant reinstalling the app got around the limit.
            </p>
          </div>
        )}
        <div className="text-sm">
          {queue.allowRepeatVisits ? (
            <p className="text-fg-soft">
              Customers may join this queue as often as they like.
            </p>
          ) : queue.repeatRestrictionPeriod && queue.repeatIdentityMode ? (
            <div className="space-y-1 text-fg-soft">
              <p>
                <span className="font-medium">{PERIOD_LABELS[queue.repeatRestrictionPeriod]}</span>
                {queue.timezone && <span className="text-muted"> ({queue.timezone})</span>}
              </p>
              <p className="text-xs text-muted">
                Customers are recognised by{' '}
                {needsPhone(queue.repeatIdentityMode) && 'a phone number they verify by SMS'}
                {queue.repeatIdentityMode === 'VERIFIED_PHONE_AND_CUSTOM_FIELD' && ' and '}
                {needsField(queue.repeatIdentityMode) &&
                  `their answer to “${identityField?.label ?? queue.repeatIdentityFieldKey}”`}
                .
              </p>
            </div>
          ) : null}
        </div>
        {!queue.deletedAt && (
          <PermissionGate permission="manage_queues">
            <Button variant="secondary" onClick={startEditing}>
              {configurationRequired ? 'Set up identification' : 'Change'}
            </Button>
          </PermissionGate>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      <fieldset className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="repeat-policy"
            checked={!restricted}
            onChange={() => setRestricted(false)}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium text-fg-soft">Unlimited visits</span>
            <span className="block text-xs text-muted">
              Anyone may join again after being served.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="repeat-policy"
            checked={restricted}
            onChange={() => setRestricted(true)}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium text-fg-soft">Limit how often a customer returns</span>
            <span className="block text-xs text-muted">
              You choose what counts as the same customer.
            </span>
          </span>
        </label>
      </fieldset>

      {restricted && (
        <div className="space-y-3 border-l-2 border-border pl-4">
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="repeat-period">
              How often may one customer use this queue?
            </label>
            <select
              id="repeat-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as RepeatRestrictionPeriod)}
              className={inputClass}
            >
              {(Object.keys(PERIOD_LABELS) as RepeatRestrictionPeriod[]).map((value) => (
                <option key={value} value={value}>
                  {PERIOD_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          {period !== 'ONCE_EVER' && (
            <div>
              <label className="mb-1 block text-xs text-muted" htmlFor="repeat-timezone">
                Which timezone does this queue run in?
              </label>
              {timezoneOptions ? (
                <select
                  id="repeat-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Choose a timezone…</option>
                  {timezoneOptions.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="repeat-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Asia/Dhaka"
                  className={inputClass}
                />
              )}
              <p className="mt-1 text-xs text-muted">
                Decides when the day, week or month actually ends for your customers.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="repeat-mode">
              How is the same customer recognised?
            </label>
            <select
              id="repeat-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as RepeatIdentityMode)}
              className={inputClass}
            >
              {(Object.keys(MODE_LABELS) as RepeatIdentityMode[]).map((value) => (
                <option key={value} value={value}>
                  {MODE_LABELS[value]}
                </option>
              ))}
            </select>
            {needsPhone(mode) && (
              // Whether SMS can actually be sent is a server capability, so
              // the server is what answers it — saving surfaces its refusal
              // rather than this page guessing and promising something the
              // backend cannot deliver.
              <p className="mt-1 text-xs text-muted">
                Requires an SMS provider on the server. If none is configured, saving will tell you
                so and nothing changes.
              </p>
            )}
          </div>

          {needsField(mode) && (
            <div>
              <label className="mb-1 block text-xs text-muted" htmlFor="repeat-field">
                Which form question identifies the customer?
              </label>
              {eligibleFields.length > 0 ? (
                <>
                  <select
                    id="repeat-field"
                    value={fieldKey}
                    onChange={(e) => setFieldKey(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Choose a question…</option>
                    {eligibleFields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted">
                    Only required text, number, email and phone questions can identify someone. A
                    yes/no or multiple-choice answer would put unrelated people under one identity.
                  </p>
                </>
              ) : (
                <p className="rounded-md border border-border bg-subtle p-2 text-xs text-fg-soft">
                  This queue has no question that could identify a customer yet. Add a required
                  text, number, email or phone question under Dynamic Form Fields first.
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-muted">
            Changing these settings applies to customers joining from now on. Visits already
            recorded are kept, so a customer who has used their visit stays recognised.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          loading={updateQueue.isPending}
          disabled={updateQueue.isPending || missingField || missingTimezone}
          onClick={() => void save()}
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

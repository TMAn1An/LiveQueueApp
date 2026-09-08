import { useState } from 'react';
import { useFormFields } from '../hooks/useFormFields';
import { useUpdateQueue } from '../hooks/useQueues';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/ErrorBanner';
import { PermissionGate } from '../components/PermissionGate';
import { ApiError } from '../api/client';
import { IDENTITY_FIELD_TYPES, SELECTABLE_IDENTITY_MODES } from '../types/queue';
import type {
  Queue,
  RepeatIdentityMode,
  RepeatRestrictionType,
  RepeatRestrictionUnit,
} from '../types/queue';
import { formatInZone } from '../utils/timezone';

/**
 * How often a customer may use this queue, and — the part that actually
 * makes the limit hold — who the queue counts as one customer (ADR-034).
 *
 * Kept out of the Details editor above it because it is not an independent
 * checkbox any more: it depends on this queue's form questions, so it has to
 * read them, and it can be invalid in ways a single toggle cannot express.
 */

/** Singular and plural, so the summary reads as a sentence rather than as
 * "1 DAYS". */
const UNIT_LABELS: Record<RepeatRestrictionUnit, [string, string]> = {
  MINUTE: ['minute', 'minutes'],
  HOUR: ['hour', 'hours'],
  DAY: ['day', 'days'],
  WEEK: ['week', 'weeks'],
  MONTH: ['month', 'months'],
  YEAR: ['year', 'years'],
};

const UNIT_ORDER: RepeatRestrictionUnit[] = ['MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'];

/** Only these two need the queue to have a timezone at all; the rest are
 * plain elapsed time. Mirrors the backend rule exactly, so the editor asks
 * for a zone in precisely the cases a save would otherwise be refused. */
function unitNeedsTimezone(unit: RepeatRestrictionUnit): boolean {
  return unit === 'MONTH' || unit === 'YEAR';
}

function describeUnit(amount: number, unit: RepeatRestrictionUnit): string {
  const [one, many] = UNIT_LABELS[unit];
  return `${amount} ${amount === 1 ? one : many}`;
}

/** One sentence each, so an administrator can tell them apart without
 * guessing what the product means by "identity" (ADR-037). */
const MODE_HELP: Partial<Record<RepeatIdentityMode, string>> = {
  VERIFIED_EMAIL: 'Customer verifies access to an email address before joining.',
  CUSTOM_FIELD: 'Use a required form question such as NID, Student ID or Membership ID.',
  VERIFIED_EMAIL_AND_CUSTOM_FIELD:
    'Use both verified email and a required form question. Useful when several people may share one email address.',
};

const MODE_LABELS: Record<RepeatIdentityMode, string> = {
  VERIFIED_EMAIL: 'Verified email',
  CUSTOM_FIELD: 'Custom unique field',
  VERIFIED_EMAIL_AND_CUSTOM_FIELD: 'Verified email + custom unique field',
  // Never offered (ADR-037), but a queue configured before the change can
  // still be holding one, and the summary has to be able to name it.
  VERIFIED_PHONE: 'Verified phone (no longer available)',
  VERIFIED_PHONE_AND_CUSTOM_FIELD: 'Verified phone + custom field (no longer available)',
};

function needsField(mode: RepeatIdentityMode): boolean {
  return (
    mode === 'CUSTOM_FIELD' ||
    mode === 'VERIFIED_PHONE_AND_CUSTOM_FIELD' ||
    mode === 'VERIFIED_EMAIL_AND_CUSTOM_FIELD'
  );
}

function needsEmail(mode: RepeatIdentityMode): boolean {
  return mode === 'VERIFIED_EMAIL' || mode === 'VERIFIED_EMAIL_AND_CUSTOM_FIELD';
}

const inputClass = 'w-full rounded-md border border-border-strong px-2 py-1.5 text-sm';

/** The stored cutoff instant rendered back onto the queue's clock as the
 * `YYYY-MM-DDTHH:mm` a datetime-local input expects. Round-tripping through
 * the queue's zone is what stops an admin in another country seeing a
 * different cutoff than the one they set. */
function toQueueLocalInput(iso: string | null, timezone: string | null): string {
  if (!iso) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(iso));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
  } catch {
    return '';
  }
}

export function RepeatVisitPolicy({
  queue,
  /** The zone this queue actually runs on — its own, or its organization's.
   * Shown here for context only; it is edited in the queue's settings. */
  effectiveTimezone,
}: {
  queue: Queue;
  effectiveTimezone: string | null;
}) {
  const { data: formFields } = useFormFields(queue.id);
  const updateQueue = useUpdateQueue(queue.id);

  const [editing, setEditing] = useState(false);
  const [restricted, setRestricted] = useState(!queue.allowRepeatVisits);
  const [type, setType] = useState<RepeatRestrictionType>(
    queue.repeatRestrictionType ?? 'DURATION',
  );
  const [amount, setAmount] = useState(String(queue.repeatRestrictionAmount ?? 1));
  const [unit, setUnit] = useState<RepeatRestrictionUnit>(queue.repeatRestrictionUnit ?? 'MONTH');
  const [until, setUntil] = useState(
    toQueueLocalInput(queue.repeatRestrictionUntil, effectiveTimezone),
  );
  // A queue still holding a deferred phone mode starts the editor on the
  // default rather than on a value the selector cannot show (ADR-037).
  const storedMode = queue.repeatIdentityMode;
  const initialMode: RepeatIdentityMode =
    storedMode && SELECTABLE_IDENTITY_MODES.includes(storedMode) ? storedMode : 'VERIFIED_EMAIL';
  const [mode, setMode] = useState<RepeatIdentityMode>(initialMode);
  const [fieldKey, setFieldKey] = useState(queue.repeatIdentityFieldKey ?? '');
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

  // Two ways a restricted queue can be unusable, and both are reported the
  // same way because they have the same consequence — joins are refused until
  // an administrator picks a method that works:
  //   * no identity method at all (a queue predating ADR-034);
  //   * a phone method, deferred by ADR-037 with no SMS provider ever built.
  // Neither is silently reinterpreted as something else. Mirrors the
  // backend's own describeJoinRequirements, which is what actually decides.
  const configurationRequired =
    !queue.allowRepeatVisits &&
    (!storedMode || !SELECTABLE_IDENTITY_MODES.includes(storedMode));

  function startEditing() {
    setRestricted(!queue.allowRepeatVisits);
    setType(queue.repeatRestrictionType ?? 'DURATION');
    setAmount(String(queue.repeatRestrictionAmount ?? 1));
    setUnit(queue.repeatRestrictionUnit ?? 'MONTH');
    setUntil(toQueueLocalInput(queue.repeatRestrictionUntil, effectiveTimezone));
    setMode(initialMode);
    setFieldKey(queue.repeatIdentityFieldKey ?? eligibleFields[0]?.key ?? '');
    setError(null);
    setEditing(true);
  }

  const parsedAmount = Number(amount);
  const amountValid = Number.isInteger(parsedAmount) && parsedAmount >= 1;

  const missingField = restricted && needsField(mode) && !fieldKey;
  const missingAmount = restricted && type === 'DURATION' && !amountValid;
  const missingUntil = restricted && type === 'UNTIL_DATETIME' && !until;
  /* The two configurations that need a calendar also need to know whose.
     Saying so here — rather than letting the save be refused — points the
     admin at the queue's settings, which is where the zone actually lives. */
  const needsZone =
    restricted &&
    (type === 'UNTIL_DATETIME' || (type === 'DURATION' && unitNeedsTimezone(unit)));
  const missingTimezone = needsZone && !effectiveTimezone;

  async function save() {
    setError(null);
    try {
      await updateQueue.mutateAsync(
        restricted
          ? {
              allowRepeatVisits: false,
              repeatRestrictionType: type,
              repeatRestrictionAmount: type === 'DURATION' ? parsedAmount : null,
              repeatRestrictionUnit: type === 'DURATION' ? unit : null,
              // Sent as the queue's own wall clock; the server turns it into
              // an instant, since only it knows which clock that is.
              repeatRestrictionUntilLocal: type === 'UNTIL_DATETIME' ? until : null,
              repeatIdentityMode: mode,
              repeatIdentityFieldKey: needsField(mode) ? fieldKey : null,
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
              {storedMode
                ? 'It identifies customers by a verified phone number, which is no longer available — SMS is not integrated. Choose verified email or a custom unique field below, and joins will work again.'
                : "It limits repeat visits but does not yet say how customers are identified. Until you choose an identity method below, joins are refused — the previous rule recognised the customer's phone app, which meant reinstalling the app got around the limit."}
            </p>
          </div>
        )}
        <div className="text-sm">
          {queue.allowRepeatVisits ? (
            <p className="text-fg-soft">
              Customers may join this queue as often as they like.
            </p>
          ) : queue.repeatRestrictionType && queue.repeatIdentityMode ? (
            <div className="space-y-1 text-fg-soft">
              <p>
                <span className="font-medium">{describeRestriction(queue, effectiveTimezone)}</span>
              </p>
              <p className="text-xs text-muted">
                Customers are recognised by{' '}
                {needsEmail(queue.repeatIdentityMode) && 'an email address they verify'}
                {queue.repeatIdentityMode === 'VERIFIED_EMAIL_AND_CUSTOM_FIELD' && ' and '}
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
          <fieldset className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="repeat-window"
                checked={type === 'ONCE_EVER'}
                onChange={() => setType('ONCE_EVER')}
                className="mt-0.5"
              />
              <span className="font-medium text-fg-soft">Only once ever</span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="repeat-window"
                checked={type === 'DURATION'}
                onChange={() => setType('DURATION')}
                className="mt-0.5"
              />
              <span className="font-medium text-fg-soft">Allow again after</span>
            </label>
            {type === 'DURATION' && (
              <div className="ml-6 flex gap-2">
                <input
                  aria-label="Amount"
                  type="number"
                  min={1}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-24 rounded-md border border-border-strong px-2 py-1.5 text-sm"
                />
                <select
                  aria-label="Unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as RepeatRestrictionUnit)}
                  className="flex-1 rounded-md border border-border-strong px-2 py-1.5 text-sm"
                >
                  {UNIT_ORDER.map((value) => (
                    <option key={value} value={value}>
                      {UNIT_LABELS[value][1].replace(/^./, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="repeat-window"
                checked={type === 'UNTIL_DATETIME'}
                onChange={() => setType('UNTIL_DATETIME')}
                className="mt-0.5"
              />
              <span className="font-medium text-fg-soft">Block until a date and time</span>
            </label>
            {type === 'UNTIL_DATETIME' && (
              <div className="ml-6">
                <input
                  aria-label="Restriction ends"
                  type="datetime-local"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  className="w-full rounded-md border border-border-strong px-2 py-1.5 text-sm"
                />
                <p className="mt-1 text-xs text-muted">
                  On this queue's clock
                  {effectiveTimezone ? ` (${effectiveTimezone})` : ''} — the same moment for every
                  customer, wherever they are.
                </p>
              </div>
            )}
          </fieldset>

          {type === 'DURATION' && amountValid && (
            <p className="text-xs text-muted">
              A customer served now could return after {describeUnit(parsedAmount, unit)}
              {unitNeedsTimezone(unit)
                ? ` — counted on the calendar, in ${effectiveTimezone ?? 'the queue’s timezone'}.`
                : '.'}
            </p>
          )}

          {missingTimezone && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              This queue has no timezone yet, and a {type === 'UNTIL_DATETIME' ? 'fixed cutoff' : 'monthly or yearly'} limit
              needs one. Set it under Queue Settings, or choose a limit measured in hours, days or
              weeks — those need no timezone at all.
            </p>
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
              {SELECTABLE_IDENTITY_MODES.map((value) => (
                <option key={value} value={value}>
                  {MODE_LABELS[value]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">{MODE_HELP[mode]}</p>
            {mode === 'VERIFIED_EMAIL' && (
              // Worth stating plainly rather than letting an operator discover
              // it from a support ticket: with email alone, one mailbox is one
              // entitlement, however many people read it.
              <p className="mt-1 text-xs text-muted">
                People who share one mailbox share one visit. If that matters here, use verified
                email + a custom unique field instead.
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
          disabled={
            updateQueue.isPending ||
            missingField ||
            missingAmount ||
            missingUntil ||
            missingTimezone
          }
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

/** The one-line summary shown when not editing. Reads as a sentence, and
 * names the clock whenever the answer depends on one. */
function describeRestriction(queue: Queue, effectiveTimezone: string | null): string {
  if (queue.repeatRestrictionType === 'ONCE_EVER') {
    return 'Each customer may use this queue once, ever';
  }
  if (queue.repeatRestrictionType === 'UNTIL_DATETIME' && queue.repeatRestrictionUntil) {
    const when = formatInZone(new Date(queue.repeatRestrictionUntil), effectiveTimezone);
    return `Nobody may return until ${when}${effectiveTimezone ? ` (${effectiveTimezone})` : ''}`;
  }
  if (queue.repeatRestrictionType === 'DURATION' && queue.repeatRestrictionAmount && queue.repeatRestrictionUnit) {
    const window = describeUnit(queue.repeatRestrictionAmount, queue.repeatRestrictionUnit);
    const zone = unitNeedsTimezone(queue.repeatRestrictionUnit) && effectiveTimezone
      ? ` (${effectiveTimezone})`
      : '';
    return `A customer may return ${window} after being served${zone}`;
  }
  return 'Repeat visits are limited';
}

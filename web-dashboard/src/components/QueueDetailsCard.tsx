import { useState, type ReactNode } from 'react';
import { useUpdateQueue } from '../hooks/useQueues';
import { Card } from './Card';
import { SectionHeading } from './SectionHeading';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { PermissionGate } from './PermissionGate';
import { InfoHelp } from './InfoHelp';
import { latinNameError, latinTextError } from '../utils/latinText';
import { actionErrorMessage } from '../utils/actionError';
import type { Queue } from '../types/queue';

const inputClass =
  'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500';

/** The range a reminder time may take — the same one a customer chooses from
 * in the app; the backend enforces it (ADR-062). */
const MIN_REMINDER_MINUTES = 2;
const MAX_REMINDER_MINUTES = 120;

/**
 * The queue's own details. What is shown and what can be edited are the
 * same set of fields, in the same order. Form version is the one read-only
 * field: it changes by itself when the customer form is edited. Multiple
 * services is not here: it is fixed at creation (ADR-055) and shown, locked,
 * with service-start verification under Services & Verification.
 */
export function QueueDetailsCard({ queue }: { queue: Queue }) {
  const updateQueue = useUpdateQueue(queue.id);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(queue.name);
  const [description, setDescription] = useState(queue.description ?? '');
  const [tokenPrefix, setTokenPrefix] = useState(queue.tokenPrefix);
  const [baseTime, setBaseTime] = useState(String(queue.baseTimeMinutes));
  const [reminder, setReminder] = useState(String(queue.defaultNotificationMinutes));

  function startEditing() {
    setName(queue.name);
    setDescription(queue.description ?? '');
    setTokenPrefix(queue.tokenPrefix);
    setBaseTime(String(queue.baseTimeMinutes));
    setReminder(String(queue.defaultNotificationMinutes));
    setError(null);
    setEditing(true);
  }

  const baseTimeValue = Number(baseTime);
  const reminderValue = Number(reminder);
  const reminderError =
    reminder.trim() !== '' &&
    (!Number.isInteger(reminderValue) ||
      reminderValue < MIN_REMINDER_MINUTES ||
      reminderValue > MAX_REMINDER_MINUTES)
      ? `Enter ${MIN_REMINDER_MINUTES}–${MAX_REMINDER_MINUTES} minutes.`
      : null;
  const nameError = latinNameError(name);
  const prefixError = latinNameError(tokenPrefix);
  const descriptionError = latinTextError(description);
  const invalid =
    Boolean(nameError || prefixError || descriptionError) ||
    !name.trim() ||
    !tokenPrefix.trim() ||
    !Number.isInteger(baseTimeValue) ||
    baseTimeValue < 1 ||
    !Number.isInteger(reminderValue) ||
    reminderValue < MIN_REMINDER_MINUTES ||
    reminderValue > MAX_REMINDER_MINUTES;

  function save() {
    setError(null);
    updateQueue.mutate(
      {
        name: name.trim(),
        description: description.trim(),
        tokenPrefix: tokenPrefix.trim(),
        baseTimeMinutes: baseTimeValue,
        defaultNotificationMinutes: reminderValue,
      },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => setError(actionErrorMessage(err)),
      },
    );
  }

  return (
    <Card>
      <SectionHeading
        title="Queue Details"
        help="How this queue is identified and its basic service rules: name, token prefix, timing and reminders."
        actions={
          !queue.deletedAt &&
          !editing && (
            <PermissionGate permission="manage_queues">
              <Button variant="secondary" onClick={startEditing}>
                Edit Details
              </Button>
            </PermissionGate>
          )
        }
      />

      {editing ? (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="queue-name" error={nameError}>
              <input
                id="queue-name"
                value={name}
                aria-invalid={nameError ? true : undefined}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Token prefix" htmlFor="queue-prefix" help="Used for new tokens only, e.g. A → A001." error={prefixError}>
              <input
                id="queue-prefix"
                value={tokenPrefix}
                maxLength={10}
                aria-invalid={prefixError ? true : undefined}
                onChange={(e) => setTokenPrefix(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Base time (minutes)" htmlFor="queue-base-time" help="Default service length used for wait estimates.">
              <input
                id="queue-base-time"
                type="number"
                min={1}
                value={baseTime}
                onChange={(e) => setBaseTime(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Reminder (minutes before turn)"
              htmlFor="queue-reminder"
              help={`The queue's default, ${MIN_REMINDER_MINUTES}–${MAX_REMINDER_MINUTES} minutes. Used unless a person picks their own time in the app.`}
              error={reminderError}
            >
              <input
                id="queue-reminder"
                type="number"
                min={MIN_REMINDER_MINUTES}
                max={MAX_REMINDER_MINUTES}
                value={reminder}
                onChange={(e) => setReminder(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Description" htmlFor="queue-description" className="sm:col-span-2" error={descriptionError}>
              <textarea
                id="queue-description"
                aria-invalid={descriptionError ? true : undefined}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="flex gap-2 border-t border-border pt-3">
            <Button loading={updateQueue.isPending} disabled={invalid} onClick={save}>
              {updateQueue.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" disabled={updateQueue.isPending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Detail label="Name" value={queue.name} />
          <Detail label="Token prefix" value={queue.tokenPrefix} />
          <Detail label="Base time" value={`${queue.baseTimeMinutes} min`} />
          <Detail
            label="Reminder"
            value={`${queue.defaultNotificationMinutes} min before`}
            help="Unless the person picks their own time"
          />
          {/* Multiple services is fixed at creation (ADR-055) and shown,
              locked, under Services & Verification — not here. */}
          <Detail label="Form version" value={`v${queue.formVersion}`} help="Changes by itself whenever the join form is edited." />
          <div className="col-span-full rounded-lg bg-subtle/50 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-faint">Description</dt>
            <dd className="mt-1 text-sm text-fg-soft">{queue.description || '—'}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  help,
  error,
  className = '',
  children,
}: {
  label: string;
  htmlFor: string;
  /** Background explanation, behind an ⓘ (ADR-053). */
  help?: string;
  /** A validation error — always on the page, never behind an icon. */
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-0.5">
        <label className="block text-xs font-medium text-fg-soft" htmlFor={htmlFor}>
          {label}
        </label>
        {help && <InfoHelp label={label}>{help}</InfoHelp>}
      </div>
      {children}
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function Detail({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="rounded-lg bg-subtle/50 p-3">
      <dt className="flex items-center gap-0.5 text-xs font-semibold uppercase tracking-wider text-faint">
        {label}
        {help && <InfoHelp label={label}>{help}</InfoHelp>}
      </dt>
      <dd className="mt-1 truncate text-base font-bold text-fg" title={value}>
        {value}
      </dd>
    </div>
  );
}

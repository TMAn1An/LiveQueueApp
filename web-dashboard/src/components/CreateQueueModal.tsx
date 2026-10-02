import { useState } from 'react';
import { useCreateQueue } from '../hooks/useQueues';
import { useAuth } from '../context/AuthContext';
import { Modal } from './Modal';
import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorBanner } from './ErrorBanner';
import { InfoHelp } from './InfoHelp';
import { Switch } from './Switch';
import {
  ImmutableSettingNote,
  MULTIPLE_SERVICES_HELP,
  MULTIPLE_SERVICES_LABEL,
  SERVICE_START_VERIFICATION_CONFIRM,
  SERVICE_START_VERIFICATION_HELP,
  SERVICE_START_VERIFICATION_LABEL,
} from './ImmutableSetting';
import { actionErrorMessage } from '../utils/actionError';
import { latinNameError } from '../utils/latinText';
import type { Queue } from '../types/queue';

const inputClass =
  'w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500 aria-invalid:border-red-500';

/**
 * The one Create Queue form (ADR-059). Every "Create Queue" action in the
 * dashboard opens this, rather than some opening it and others merely
 * navigating to the Queues page.
 *
 * ADR-055: multiple services and service-start verification are fixed once
 * the queue exists, so both are chosen here and say so. Verification starts
 * off, and turning it on asks for an explicit confirmation first.
 */
export function CreateQueueModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (queue: Queue) => void;
}) {
  const createQueue = useCreateQueue();
  const [name, setName] = useState('');
  const [tokenPrefix, setTokenPrefix] = useState('A');
  const [allowMultipleServices, setAllowMultipleServices] = useState(true);
  const [requireServiceStartOtp, setRequireServiceStartOtp] = useState(false);
  const [confirmingVerification, setConfirmingVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = latinNameError(name);
  const prefixError = latinNameError(tokenPrefix);
  const canSubmit =
    name.trim() !== '' && tokenPrefix.trim() !== '' && !nameError && !prefixError && !createQueue.isPending;

  function changeVerification(next: boolean) {
    if (next) {
      // Not switched on until the creator confirms it is meant to be permanent.
      setConfirmingVerification(true);
    } else {
      setRequireServiceStartOtp(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    try {
      const created = await createQueue.mutateAsync({
        name: name.trim(),
        tokenPrefix: tokenPrefix.trim(),
        allowMultipleServices,
        requireServiceStartOtp,
      });
      onCreated?.(created.data);
      onClose();
    } catch (err) {
      setError(actionErrorMessage(err));
    }
  }

  if (confirmingVerification) {
    return (
      <ConfirmDialog
        title="Turn on service-start verification?"
        message={SERVICE_START_VERIFICATION_CONFIRM}
        confirmLabel="Enable permanently"
        tone="primary"
        onConfirm={() => {
          setRequireServiceStartOtp(true);
          setConfirmingVerification(false);
        }}
        onCancel={() => {
          setRequireServiceStartOtp(false);
          setConfirmingVerification(false);
        }}
      />
    );
  }

  return (
    <Modal title="Create Queue" onClose={onClose}>
      <ErrorBanner message={error} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void handleSubmit();
        }}
      >
        <div>
          <label htmlFor="create-queue-name" className="mb-1 block text-sm font-medium text-fg-soft">
            Queue name
          </label>
          <input
            id="create-queue-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Front Desk, Pharmacy, Billing"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'create-queue-name-error' : undefined}
            className={`${inputClass} border-border-strong`}
          />
          {nameError && (
            <p id="create-queue-name-error" role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
              {nameError}
            </p>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-0.5">
            <label htmlFor="create-queue-prefix" className="block text-sm font-medium text-fg-soft">
              Token prefix
            </label>
            <InfoHelp label="token prefix">Tokens are numbered from it — A001, A002 and so on.</InfoHelp>
          </div>
          <input
            id="create-queue-prefix"
            value={tokenPrefix}
            onChange={(e) => setTokenPrefix(e.target.value)}
            maxLength={10}
            placeholder="e.g. A, PH, VIP"
            aria-invalid={prefixError ? true : undefined}
            aria-describedby={prefixError ? 'create-queue-prefix-error' : undefined}
            className={`${inputClass} border-border-strong`}
          />
          {prefixError && (
            <p id="create-queue-prefix-error" role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
              {prefixError}
            </p>
          )}
        </div>

        <fieldset className="space-y-4 rounded-lg border border-border bg-subtle/50 p-3.5">
          <legend className="sr-only">Settings fixed at creation</legend>
          <div>
            <Switch
              id="create-queue-multiple-services"
              checked={allowMultipleServices}
              onChange={setAllowMultipleServices}
              label={MULTIPLE_SERVICES_LABEL}
              help={MULTIPLE_SERVICES_HELP}
            />
            <div className="pl-12">
              <ImmutableSettingNote label={MULTIPLE_SERVICES_LABEL} />
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <Switch
              id="create-queue-service-start-verification"
              checked={requireServiceStartOtp}
              onChange={changeVerification}
              label={SERVICE_START_VERIFICATION_LABEL}
              help={SERVICE_START_VERIFICATION_HELP}
            />
            <div className="pl-12">
              <ImmutableSettingNote label={SERVICE_START_VERIFICATION_LABEL} />
            </div>
          </div>
        </fieldset>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="inline-flex items-center text-xs text-muted">
            Repeat-visit limits
            <InfoHelp label="repeat-visit limits">
              Customers may join as often as they like. To limit repeat visits, open the queue after
              creating it and set up how customers are identified.
            </InfoHelp>
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} loading={createQueue.isPending}>
              {createQueue.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/**
 * ADR-059: the only "Create Queue" button. It opens the real form, and
 * renders nothing at all for someone who may not create queues — no
 * disabled look-alike for STAFF. The backend refuses the request regardless.
 */
export function CreateQueueButton({
  size = 'lg',
  variant = 'primary',
  label = 'Create Queue',
  onCreated,
}: {
  size?: ButtonSize;
  variant?: ButtonVariant;
  label?: string;
  onCreated?: (queue: Queue) => void;
}) {
  const { hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  if (!hasPermission('manage_queues')) return null;
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
        </svg>
        {label}
      </Button>
      {open && <CreateQueueModal onClose={() => setOpen(false)} onCreated={onCreated} />}
    </>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateQueue, useQueues } from '../hooks/useQueues';
import { useAdmins, useStaffList } from '../hooks/useStaff';
import { useAuth } from '../context/AuthContext';
import { Modal } from './Modal';
import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorBanner } from './ErrorBanner';
import { InfoHelp } from './InfoHelp';
import { Switch } from './Switch';
import {
  ImmutableSettingNote,
  SERVICE_START_VERIFICATION_CONFIRM,
  SERVICE_START_VERIFICATION_HELP,
  SERVICE_START_VERIFICATION_LABEL,
} from './ImmutableSetting';
import { actionErrorMessage } from '../utils/actionError';
import { latinNameError } from '../utils/latinText';
import type { Queue } from '../types/queue';

const inputClass =
  'w-full rounded-md border bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500 aria-invalid:border-red-500';

type OperatorChoice = 'self' | 'executive';

/**
 * ADR-069: who operates the new queue's first counter. "Assign myself" is
 * the default — the queue's Admin (for the Organization Head creating it,
 * the Admin they name). Otherwise one of that Admin's active Executives.
 */
function FirstCounterFields({
  adminId,
  isHead,
  counterName,
  onCounterName,
  choice,
  onChoice,
  executiveId,
  onExecutive,
  onInvite,
}: {
  adminId: string;
  isHead: boolean;
  counterName: string;
  onCounterName: (v: string) => void;
  choice: OperatorChoice;
  onChoice: (v: OperatorChoice) => void;
  executiveId: string;
  onExecutive: (v: string) => void;
  onInvite: () => void;
}) {
  const { data, isLoading } = useStaffList(1, 100, '', isHead ? adminId : '', Boolean(adminId));
  const executives = (data?.data ?? []).filter(
    (s) => s.role === 'STAFF' && s.status === 'ACTIVE' && s.workspaceAdminId === adminId,
  );
  const counterNameError = latinNameError(counterName);
  const selfLabel = isHead ? 'Assign the Admin' : 'Assign myself';

  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3.5">
      <legend className="px-1 text-sm font-medium text-fg-soft">First counter</legend>
      <div>
        <label htmlFor="create-queue-counter-name" className="mb-1 block text-xs font-medium text-fg-soft">
          Counter name
        </label>
        <input
          id="create-queue-counter-name"
          value={counterName}
          onChange={(e) => onCounterName(e.target.value)}
          aria-invalid={counterNameError ? true : undefined}
          className={`${inputClass} border-border-strong`}
        />
        {counterNameError && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
            {counterNameError}
          </p>
        )}
      </div>
      <div role="radiogroup" aria-label="Who operates it" className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="radio"
            name="create-queue-operator"
            checked={choice === 'self'}
            onChange={() => onChoice('self')}
          />
          {selfLabel}
        </label>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="radio"
            name="create-queue-operator"
            checked={choice === 'executive'}
            onChange={() => onChoice('executive')}
          />
          Assign an Executive
        </label>
      </div>
      {choice === 'executive' &&
        (isLoading ? (
          <p className="text-xs text-muted">Loading Executives…</p>
        ) : executives.length === 0 ? (
          <div role="status" className="rounded-md bg-subtle px-3 py-2.5 text-sm text-fg-soft">
            <p>No Executives available. Add an Executive first, or assign yourself to this counter.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="md" variant="secondary" onClick={onInvite}>
                Invite Executive
              </Button>
              <Button size="md" variant="outline" onClick={() => onChoice('self')}>
                {isHead ? 'Assign the Admin' : 'Assign Myself'}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="create-queue-executive" className="mb-1 block text-xs font-medium text-fg-soft">
              Executive
            </label>
            <select
              id="create-queue-executive"
              value={executiveId}
              onChange={(e) => onExecutive(e.target.value)}
              className={`${inputClass} border-border-strong`}
            >
              <option value="">Choose an Executive…</option>
              {executives.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        ))}
    </fieldset>
  );
}

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
  const navigate = useNavigate();
  const { staff, hasPermission } = useAuth();
  // ADR-069: the Organization Head creates a queue for a named Admin; an
  // Admin's queue is always their own.
  const isHead = hasPermission('manage_admins');
  const { admins, isLoading: loadingAdmins } = useAdmins(isHead);
  const { data: queues } = useQueues();
  const adminsWithQueue = new Set((queues ?? []).map((q) => q.adminId).filter(Boolean));
  const availableAdmins = admins.filter((a) => !adminsWithQueue.has(a.id));
  const [adminId, setAdminId] = useState('');
  const queueAdminId = isHead ? adminId : (staff?.id ?? '');
  const [name, setName] = useState('');
  // Optional: the first letter of the name unless the creator types one.
  const [tokenPrefix, setTokenPrefix] = useState('');
  const [counterName, setCounterName] = useState('Counter 1');
  const [operatorChoice, setOperatorChoice] = useState<OperatorChoice>('self');
  const [executiveId, setExecutiveId] = useState('');
  const [requireServiceStartOtp, setRequireServiceStartOtp] = useState(false);
  const [confirmingVerification, setConfirmingVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = latinNameError(name);
  const prefixError = latinNameError(tokenPrefix);
  const counterNameError = latinNameError(counterName);
  const effectivePrefix = tokenPrefix.trim() || name.trim().charAt(0).toUpperCase();
  const canSubmit =
    name.trim() !== '' &&
    !nameError &&
    !prefixError &&
    counterName.trim() !== '' &&
    !counterNameError &&
    Boolean(queueAdminId) &&
    (operatorChoice === 'self' || Boolean(executiveId)) &&
    !createQueue.isPending;

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
        ...(effectivePrefix ? { tokenPrefix: effectivePrefix } : {}),
        ...(isHead ? { adminId } : {}),
        firstCounter: {
          name: counterName.trim(),
          ...(operatorChoice === 'executive' ? { operatorStaffId: executiveId } : {}),
        },
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
        {isHead && (
          <div>
            <label htmlFor="create-queue-admin" className="mb-1 block text-sm font-medium text-fg-soft">
              Admin
            </label>
            {loadingAdmins ? (
              <p className="text-xs text-muted">Loading Admins…</p>
            ) : availableAdmins.length === 0 ? (
              <div role="status" className="rounded-md bg-subtle px-3 py-2.5 text-sm text-fg-soft">
                <p>Every queue belongs to one Admin, and each Admin runs one queue. Invite an Admin first.</p>
                <div className="mt-2">
                  <Button size="md" variant="secondary" onClick={() => navigate('/staff?invite=ADMIN')}>
                    Invite Admin
                  </Button>
                </div>
              </div>
            ) : (
              <select
                id="create-queue-admin"
                value={adminId}
                onChange={(e) => {
                  setAdminId(e.target.value);
                  setExecutiveId('');
                }}
                className={`${inputClass} border-border-strong`}
              >
                <option value="">Choose the Admin whose queue this is…</option>
                {availableAdmins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
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
              Token prefix (optional)
            </label>
            <InfoHelp label="token prefix">
              Tokens are numbered from it — A001, A002 and so on. Left empty, it is the first letter of the
              queue name.
            </InfoHelp>
          </div>
          <input
            id="create-queue-prefix"
            value={tokenPrefix}
            onChange={(e) => setTokenPrefix(e.target.value)}
            maxLength={10}
            placeholder={effectivePrefix ? `${effectivePrefix} (from the name)` : 'e.g. A, PH, VIP'}
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

        {queueAdminId && (
          <FirstCounterFields
            adminId={queueAdminId}
            isHead={isHead}
            counterName={counterName}
            onCounterName={setCounterName}
            choice={operatorChoice}
            onChoice={setOperatorChoice}
            executiveId={executiveId}
            onExecutive={setExecutiveId}
            onInvite={() => {
              onClose();
              navigate('/staff?invite=STAFF');
            }}
          />
        )}

        <fieldset className="space-y-4 rounded-lg border border-border bg-subtle/50 p-3.5">
          <legend className="sr-only">Settings fixed at creation</legend>
          <div>
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
              People may join as often as they like. To limit repeat visits, open the queue after
              creating it and set up how people are identified.
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
  const { hasPermission, staff } = useAuth();
  const { data: queues } = useQueues();
  const [open, setOpen] = useState(false);
  if (!hasPermission('manage_queues')) return null;
  // ADR-069: one Admin, one queue — an Admin who already runs one has
  // nothing to create.
  if (staff?.role === 'ADMIN' && (queues ?? []).some((q) => q.adminId === staff.id)) return null;
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

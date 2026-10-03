import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueue } from '../hooks/useQueues';
import {
  useAssignCounter,
  useAssignableStaff,
  useCounters,
  useCreateCounter,
  useDeleteCounter,
  useSetCounterServices,
  useSetCounterStatus,
  useUpdateCounter,
} from '../hooks/useCounters';
import { Card } from '../components/Card';
import { InfoHelp } from '../components/InfoHelp';
import { Button } from '../components/Button';
import { FieldError } from '../components/FieldError';
import { latinNameError } from '../utils/latinText';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { QueueBreadcrumb } from '../components/QueueBreadcrumb';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState, InlineSpinner } from '../components/Spinner';
import { useAuth } from '../context/AuthContext';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiError } from '../api/client';
import { roleLabel } from '../types/auth';
import type { AssignableStaff, Counter, CounterStatus, QueueServiceItem } from '../types/queue';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** ADR-069: what each state means, in the words the buttons use. */
const STATUS_HELP: Record<CounterStatus, string> = {
  ACTIVE: 'Open — its operator serves people here.',
  ON_BREAK: 'Paused — its operator stays assigned, but nobody is called here.',
  OFFLINE: 'Off — nobody is assigned, and nobody is called here.',
};

function personLabel(s: AssignableStaff, me: string | undefined): string {
  return `${s.name}${s.id === me ? ' (you)' : ''} · ${roleLabel(s.role)}`;
}

/**
 * ADR-069: who may operate this counter — the queue's Admin and their
 * Executives (for a Head-managed queue, the Head and organization-level
 * Executives), as the backend lists them. Someone on another counter of
 * this queue can only come here through a confirmed move.
 */
function OperatorPicker({
  counter,
  value,
  onChange,
  includeCurrent,
  label,
}: {
  counter: Counter;
  value: string;
  onChange: (staff: AssignableStaff | null) => void;
  includeCurrent: boolean;
  label: string;
}) {
  const { staff: me } = useAuth();
  const { data: assignable, isLoading } = useAssignableStaff(counter.id, true);
  const options = (assignable ?? []).filter((s) => includeCurrent || s.id !== counter.staffId);
  const free = options.filter((s) => !s.currentCounter || s.currentCounter.id === counter.id);
  const elsewhere = options.filter((s) => s.currentCounter && s.currentCounter.id !== counter.id);
  return (
    <select
      value={value}
      aria-label={label}
      disabled={isLoading}
      onChange={(e) => onChange(options.find((s) => s.id === e.target.value) ?? null)}
      className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-fg focus:border-brand-500"
    >
      <option value="">{isLoading ? 'Loading…' : free.length + elsewhere.length === 0 ? 'Nobody available' : 'Choose an operator…'}</option>
      {free.map((s) => (
        <option key={s.id} value={s.id}>
          {personLabel(s, me?.id)}
        </option>
      ))}
      {elsewhere.length > 0 && (
        <optgroup label="On another counter — move here">
          {elsewhere.map((s) => (
            <option key={s.id} value={s.id}>
              {personLabel(s, me?.id)} — on {s.currentCounter!.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/** ADR-070: which services a counter handles. None ticked = every service. */
function CounterServicesDialog({
  queueId,
  counter,
  services,
  onClose,
}: {
  queueId: string;
  counter: Counter;
  services: QueueServiceItem[];
  onClose: () => void;
}) {
  const setServices = useSetCounterServices(queueId);
  const [all, setAll] = useState((counter.serviceIds ?? []).length === 0);
  const [chosen, setChosen] = useState<Set<string>>(new Set(counter.serviceIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const canSave = all || chosen.size > 0;

  return (
    <Modal title={`Services at ${counter.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-fg-soft">
          People are called here only for the services it handles. An operator can refer someone
          whose next step this counter does not handle to one that does.
        </p>
        <label className="flex items-center gap-2 text-sm font-medium text-fg">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Every service (default)
        </label>
        <fieldset disabled={all} className="space-y-2 pl-6 disabled:opacity-50">
          <legend className="sr-only">Only these services</legend>
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={chosen.has(s.id)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(s.id);
                  else next.delete(s.id);
                  setChosen(next);
                }}
              />
              {s.serviceName}
              {!s.isActive && <span className="text-xs text-faint">(inactive)</span>}
            </label>
          ))}
        </fieldset>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            loading={setServices.isPending}
            onClick={() => {
              setError(null);
              setServices.mutate(
                { counterId: counter.id, serviceIds: all ? [] : [...chosen] },
                { onSuccess: onClose, onError: (err) => setError(errorMessage(err, 'Failed to save the services.')) },
              );
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CounterRow({
  queueId,
  counter,
  services,
  canManage,
  onError,
}: {
  queueId: string;
  counter: Counter;
  services: QueueServiceItem[];
  canManage: boolean;
  onError: (message: string) => void;
}) {
  const { staff } = useAuth();
  const updateCounter = useUpdateCounter(queueId);
  const setStatus = useSetCounterStatus(queueId);
  const assignCounter = useAssignCounter(queueId);
  const deleteCounter = useDeleteCounter(queueId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [confirmingMove, setConfirmingMove] = useState<AssignableStaff | null>(null);
  const [editingServices, setEditingServices] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(counter.name);
  const nameError = latinNameError(name);
  const isMine = Boolean(staff && counter.staffId === staff.id);
  const isOff = counter.status === 'OFFLINE';
  // An off counter is opened together with the person who will run it.
  const [openingWith, setOpeningWith] = useState<AssignableStaff | null>(null);
  const routed = (counter.serviceIds ?? []).length > 0;
  const serviceNames = (counter.serviceIds ?? [])
    .map((id) => services.find((s) => s.id === id)?.serviceName)
    .filter(Boolean)
    .join(', ');

  function changeStatus(status: CounterStatus, operatorStaffId?: string) {
    onError('');
    setStatus.mutate(
      { counterId: counter.id, status, operatorStaffId },
      {
        onSuccess: () => {
          setConfirmingOff(false);
          setOpeningWith(null);
        },
        onError: (err) => {
          setConfirmingOff(false);
          onError(errorMessage(err, 'Failed to change counter status.'));
        },
      },
    );
  }

  return (
    <tr className="border-b border-border align-top transition-colors hover:bg-subtle/50">
      <td className="py-3 pr-4 font-semibold text-fg">
        {editing ? (
          <div>
            <input
              value={name}
              aria-label="Counter name"
              aria-invalid={nameError ? true : undefined}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-md border border-border-strong px-3 text-sm bg-surface text-fg focus:border-brand-500"
            />
            <FieldError message={nameError} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-brand-500" />
            <span>{counter.name}</span>
            {isMine && (
              <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-bold text-brand-fg ring-1 ring-brand-200 dark:bg-brand-950/60 dark:ring-brand-800">
                Your counter
              </span>
            )}
          </div>
        )}
        <p className="mt-1 text-xs font-normal text-muted">{routed ? serviceNames : 'Every service'}</p>
      </td>
      <td className="py-3 pr-4">
        <span title={STATUS_HELP[counter.status]}>
          <StatusBadge status={counter.status} size="sm" />
        </span>
      </td>
      <td className="py-3 pr-4 text-sm text-fg-soft font-medium">
        {counter.operator ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-subtle px-2 py-0.5 text-xs text-fg">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {counter.operator.name}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      <td className="py-3 pr-4">
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {isOff ? (
              <>
                <OperatorPicker
                  counter={counter}
                  value={openingWith?.id ?? ''}
                  includeCurrent
                  label={`Operator for ${counter.name}`}
                  onChange={setOpeningWith}
                />
                <Button
                  disabled={!openingWith || openingWith.currentCounter !== null}
                  loading={setStatus.isPending}
                  onClick={() => openingWith && changeStatus('ACTIVE', openingWith.id)}
                >
                  Open
                </Button>
                {openingWith?.currentCounter && (
                  <Button variant="secondary" onClick={() => setConfirmingMove(openingWith)}>
                    Move here
                  </Button>
                )}
              </>
            ) : (
              <>
                {counter.status === 'ACTIVE' ? (
                  <Button variant="secondary" loading={setStatus.isPending} onClick={() => changeStatus('ON_BREAK')}>
                    Pause
                  </Button>
                ) : (
                  <Button loading={setStatus.isPending} onClick={() => changeStatus('ACTIVE')}>
                    Resume
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setConfirmingOff(true)}>
                  Turn Off
                </Button>
                <div className="flex items-center gap-1">
                  <OperatorPicker
                    counter={counter}
                    value=""
                    includeCurrent={false}
                    label={`Change the operator of ${counter.name}`}
                    onChange={(chosen) => {
                      if (!chosen) return;
                      onError('');
                      if (chosen.currentCounter) {
                        setConfirmingMove(chosen);
                        return;
                      }
                      assignCounter.mutate(
                        { counterId: counter.id, staffId: chosen.id },
                        { onError: (err) => onError(errorMessage(err, 'Failed to assign the operator.')) },
                      );
                    }}
                  />
                  {assignCounter.isPending && (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <InlineSpinner />
                      Assigning…
                    </span>
                  )}
                </div>
              </>
            )}
            <Button variant="outline" onClick={() => setEditingServices(true)}>
              Services
            </Button>
            {editing ? (
              <>
                <Button
                  loading={updateCounter.isPending}
                  disabled={!name.trim() || Boolean(nameError)}
                  onClick={() => {
                    onError('');
                    updateCounter.mutate(
                      { counterId: counter.id, name },
                      {
                        onSuccess: () => setEditing(false),
                        onError: (err) => onError(errorMessage(err, 'Failed to rename counter.')),
                      },
                    );
                  }}
                >
                  {updateCounter.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={updateCounter.isPending}
                  onClick={() => {
                    setName(counter.name);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setEditing(true)}>
                Rename
              </Button>
            )}
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        )}
        {editingServices && (
          <CounterServicesDialog
            queueId={queueId}
            counter={counter}
            services={services}
            onClose={() => setEditingServices(false)}
          />
        )}
        {confirmingOff && (
          <ConfirmDialog
            title={`Turn off ${counter.name}?`}
            message={`${counter.operator?.name ?? 'Its operator'} is released from this counter and nobody is called here until it is opened again with an operator. To keep them assigned, pause it instead.`}
            confirmLabel="Turn Off"
            confirmingLabel="Turning off…"
            tone="primary"
            confirming={setStatus.isPending}
            onConfirm={() => changeStatus('OFFLINE')}
            onCancel={() => setConfirmingOff(false)}
          />
        )}
        {confirmingMove && (
          <ConfirmDialog
            title={`Move ${confirmingMove.name} to ${counter.name}?`}
            message={`${confirmingMove.name} will leave ${confirmingMove.currentCounter!.name}, which turns off, and stand at ${counter.name} instead. A person can only be at one counter.`}
            confirmLabel="Move"
            tone="primary"
            confirming={assignCounter.isPending}
            onConfirm={() => {
              assignCounter.mutate(
                { counterId: counter.id, staffId: confirmingMove.id, move: true },
                {
                  onSuccess: () => {
                    setConfirmingMove(null);
                    setOpeningWith(null);
                  },
                  onError: (err) => {
                    setConfirmingMove(null);
                    onError(errorMessage(err, 'Failed to move the operator.'));
                  },
                },
              );
            }}
            onCancel={() => setConfirmingMove(null)}
          />
        )}
        {confirmingDelete && (
          <ConfirmDialog
            title={`Delete counter "${counter.name}"?`}
            message="Nobody will be able to serve people from this counter, and its operator is released. A queue always keeps at least one counter. This cannot be undone."
            confirming={deleteCounter.isPending}
            onConfirm={() => {
              onError('');
              deleteCounter.mutate(counter.id, {
                onSuccess: () => setConfirmingDelete(false),
                onError: (err) => {
                  setConfirmingDelete(false);
                  onError(errorMessage(err, 'Failed to delete counter.'));
                },
              });
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </td>
    </tr>
  );
}

export function QueueCountersPage() {
  const { queueId } = useParams<{ queueId: string }>();
  const { hasPermission } = useAuth();
  const { data: queue } = useQueue(queueId);
  const { data: counters, isLoading } = useCounters(queueId);
  const createCounter = useCreateCounter(queueId ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const newNameError = latinNameError(name);
  // ADR-069: counters are managed by the queue's Admin (or the Head); the
  // server says whether that is the signed-in person.
  const canManage = hasPermission('manage_counters') && queue?.canManage !== false;

  if (!queueId) return null;

  return (
    <div className="space-y-6">
      <div>
        <QueueBreadcrumb
          queueId={queueId}
          queueName={queue?.name ?? 'Queue'}
          section="Counters"
          backTo={`/queues/${queueId}`}
          backLabel={`Back to ${queue?.name ?? 'Queue'}`}
        />
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">Counters</h1>
          <InfoHelp label="Counters">
            Desks and service points where people are served. An open or paused counter always has
            one operator — the queue&apos;s Admin or one of their Executives, one counter each. Pause
            keeps the operator assigned; Turn Off releases them. By default a counter handles every
            service; limit it with Services.
          </InfoHelp>
        </div>
      </div>

      <ErrorBanner message={error} />

      <Card>
        {isLoading ? (
          <Spinner label="Loading counters…" />
        ) : !counters?.length ? (
          <EmptyState message="No counters yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                  <th className="py-3 pr-4">Name</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Assigned Operator</th>
                  <th className="py-3 pr-4">{canManage ? 'Actions' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {counters.map((c) => (
                  <CounterRow
                    key={c.id}
                    queueId={queueId}
                    counter={c}
                    services={queue?.services ?? []}
                    canManage={canManage}
                    onError={setError}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage && (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Add Service Counter
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:max-w-xs">
                <label htmlFor="new-counter-name" className="mb-1 block text-xs text-muted">New counter name</label>
                <input
                  id="new-counter-name"
                  value={name}
                  aria-invalid={newNameError ? true : undefined}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Counter 2, Window A"
                  className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
                />
              </div>
              <Button
                disabled={!name.trim() || Boolean(newNameError)}
                loading={createCounter.isPending}
                onClick={() => {
                  setError(null);
                  createCounter.mutate(name, {
                    onSuccess: () => setName(''),
                    onError: (err) => setError(errorMessage(err, 'Failed to create counter.')),
                  });
                }}
              >
                {createCounter.isPending ? 'Adding…' : 'Add Counter'}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted">A new counter starts off. Open it with an operator.</p>
            <FieldError message={newNameError} />
          </div>
        )}
      </Card>
    </div>
  );
}

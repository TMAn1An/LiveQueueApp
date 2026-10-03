import { useState } from 'react';
import {
  useCreateService,
  useDeleteService,
  useSetServiceStatus,
  useUpdateService,
} from '../hooks/useServices';
import { Button } from './Button';
import { FieldError } from './FieldError';
import { latinNameError } from '../utils/latinText';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusBadge } from './StatusBadge';
import { PermissionGate } from './PermissionGate';
import { EmptyState } from './Spinner';
import { ErrorBanner } from './ErrorBanner';
import { actionErrorMessage } from '../utils/actionError';
import type { QueueServiceItem } from '../types/queue';

const MAX_REPEAT_LIMIT = 10;

function repeatLimitText(limit: number): string {
  return limit === 1 ? 'Once per visit' : `Up to ${limit}× per visit`;
}

function ServiceRow({
  queueId,
  service,
  editable,
}: {
  queueId: string;
  service: QueueServiceItem;
  editable: boolean;
}) {
  const updateService = useUpdateService(queueId);
  const setStatus = useSetServiceStatus(queueId);
  const deleteService = useDeleteService(queueId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(service.serviceName);
  const [duration, setDuration] = useState(service.durationMinutes);
  const [repeatLimit, setRepeatLimit] = useState(service.maxOccurrencesPerJourney ?? 2);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const nameError = latinNameError(name);
  const showRowError = (err: unknown) => setRowError(actionErrorMessage(err));

  if (editing) {
    return (
      <tr className="border-b border-border bg-subtle/30">
        <td className="py-3 pr-4">
          <input
            value={name}
            aria-label="Service name"
            aria-invalid={nameError ? true : undefined}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
          />
          <FieldError message={nameError} />
        </td>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={duration}
              aria-label="Duration in minutes"
              onChange={(e) => setDuration(Number(e.target.value))}
              className="h-9 w-20 rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
            />
            <span className="text-xs text-muted">min</span>
          </div>
        </td>
        <td className="py-3 pr-4">
          <input
            type="number"
            min={1}
            max={MAX_REPEAT_LIMIT}
            value={repeatLimit}
            aria-label="Times one visit may include this service"
            onChange={(e) => setRepeatLimit(Number(e.target.value))}
            className="h-9 w-20 rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
          />
        </td>
        <td className="py-3 pr-4">
          <StatusBadge status={service.isActive ? 'ACTIVE' : 'INACTIVE'} size="sm" />
        </td>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2">
            <Button
              loading={updateService.isPending}
              disabled={!name.trim() || Boolean(nameError) || repeatLimit < 1 || repeatLimit > MAX_REPEAT_LIMIT}
              onClick={() =>
                updateService.mutate(
                  {
                    serviceId: service.id,
                    input: { serviceName: name, durationMinutes: duration, maxOccurrencesPerJourney: repeatLimit },
                  },
                  { onSuccess: () => setEditing(false), onError: showRowError },
                )
              }
            >
              {updateService.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {rowError && <div className="mt-2"><ErrorBanner message={rowError} /></div>}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border transition-colors hover:bg-subtle/50">
      <td className="py-3 pr-4 font-semibold text-fg">
        {service.serviceName}
      </td>
      <td className="py-3 pr-4">
        <span className="inline-flex items-center rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-fg-soft border border-border">
          {service.durationMinutes} min
        </span>
      </td>
      <td className="py-3 pr-4 text-xs text-fg-soft">{repeatLimitText(service.maxOccurrencesPerJourney ?? 2)}</td>
      <td className="py-3 pr-4">
        <StatusBadge status={service.isActive ? 'ACTIVE' : 'INACTIVE'} size="sm" />
      </td>
      <td className="py-3 pr-4">
        {editable && (
        <PermissionGate permission="manage_services">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="secondary"
              loading={setStatus.isPending}
              onClick={() => {
                setRowError(null);
                setStatus.mutate({ serviceId: service.id, isActive: !service.isActive }, { onError: showRowError });
              }}
            >
              {setStatus.isPending ? 'Updating…' : service.isActive ? 'Deactivate' : 'Activate'}
            </Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        </PermissionGate>
        )}
        {rowError && <div className="mt-2"><ErrorBanner message={rowError} /></div>}
        {confirmingDelete && (
          <ConfirmDialog
            title={`Delete service "${service.serviceName}"?`}
            message="People will no longer be able to select this service. This cannot be undone."
            confirming={deleteService.isPending}
            onConfirm={() =>
              deleteService.mutate(service.id, {
                onSuccess: () => setConfirmingDelete(false),
                onError: (err) => {
                  setConfirmingDelete(false);
                  showRowError(err);
                },
              })
            }
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </td>
    </tr>
  );
}

export function ServicesManager({
  queueId,
  services,
  editable = true,
}: {
  queueId: string;
  services: QueueServiceItem[];
  /** ADR-069: false for someone who may see but not change this queue. */
  editable?: boolean;
}) {
  const createService = useCreateService(queueId);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(5);
  const [repeatLimit, setRepeatLimit] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const nameError = latinNameError(name);

  return (
    <div className="space-y-4">
      {services.length === 0 ? (
        <EmptyState message="No services yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                <th className="py-3 pr-4">Name</th>
                <th className="py-3 pr-4">Duration</th>
                <th className="py-3 pr-4">Repeats</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <ServiceRow key={s.id} queueId={queueId} service={s} editable={editable} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && (
      <PermissionGate permission="manage_services">
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Add Service
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:max-w-xs">
              <label htmlFor={`new-service-name-${queueId}`} className="mb-1 block text-xs font-medium text-fg-soft">Service name</label>
              <input
                id={`new-service-name-${queueId}`}
                value={name}
                placeholder="e.g. Consultation, Prescription Pickup"
                aria-invalid={nameError ? true : undefined}
                onChange={(e) => setName(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
              />
            </div>
            <div>
              <label htmlFor={`new-service-duration-${queueId}`} className="mb-1 block text-xs font-medium text-fg-soft">Duration (min)</label>
              <input
                id={`new-service-duration-${queueId}`}
                type="number"
                min={1}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="h-9 w-24 rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
              />
            </div>
            <div>
              <label htmlFor={`new-service-repeats-${queueId}`} className="mb-1 block text-xs font-medium text-fg-soft">
                Max per visit
              </label>
              <input
                id={`new-service-repeats-${queueId}`}
                type="number"
                min={1}
                max={MAX_REPEAT_LIMIT}
                value={repeatLimit}
                onChange={(e) => setRepeatLimit(Number(e.target.value))}
                className="h-9 w-24 rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
              />
            </div>
            <Button
              disabled={!name.trim() || Boolean(nameError) || repeatLimit < 1 || repeatLimit > MAX_REPEAT_LIMIT}
              loading={createService.isPending}
              onClick={() => {
                setError(null);
                createService.mutate(
                  { serviceName: name.trim(), durationMinutes: duration, maxOccurrencesPerJourney: repeatLimit },
                  {
                    onSuccess: () => setName(''),
                    // Used to fail silently; a refusal now says why.
                    onError: (err) => setError(actionErrorMessage(err)),
                  },
                );
              }}
            >
              {createService.isPending ? 'Adding…' : 'Add Service'}
            </Button>
          </div>
          <FieldError message={nameError} />
          <p className="mt-2 text-xs text-muted">
            Max per visit: how many times one person may include this service in their visit. It can
            never be two steps in a row.
          </p>
          {error && <div className="mt-2"><ErrorBanner message={error} /></div>}
        </div>
      </PermissionGate>
      )}
    </div>
  );
}

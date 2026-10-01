import { useState } from 'react';
import {
  useCreateService,
  useDeleteService,
  useSetServiceStatus,
  useUpdateService,
} from '../hooks/useServices';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusBadge } from './StatusBadge';
import { PermissionGate } from './PermissionGate';
import { EmptyState } from './Spinner';
import { ErrorBanner } from './ErrorBanner';
import { actionErrorMessage } from '../utils/actionError';
import type { QueueServiceItem } from '../types/queue';

function ServiceRow({ queueId, service }: { queueId: string; service: QueueServiceItem }) {
  const updateService = useUpdateService(queueId);
  const setStatus = useSetServiceStatus(queueId);
  const deleteService = useDeleteService(queueId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(service.serviceName);
  const [duration, setDuration] = useState(service.durationMinutes);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const showRowError = (err: unknown) => setRowError(actionErrorMessage(err));

  if (editing) {
    return (
      <tr className="border-b border-border bg-subtle/30">
        <td className="py-3 pr-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-fg focus:border-brand-500"
          />
        </td>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-20 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-fg focus:border-brand-500"
            />
            <span className="text-xs text-muted">min</span>
          </div>
        </td>
        <td className="py-3 pr-4">
          <StatusBadge status={service.isActive ? 'ACTIVE' : 'INACTIVE'} size="sm" />
        </td>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2">
            <Button
              loading={updateService.isPending}
              onClick={() =>
                updateService.mutate(
                  { serviceId: service.id, input: { serviceName: name, durationMinutes: duration } },
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
      <td className="py-3 pr-4">
        <StatusBadge status={service.isActive ? 'ACTIVE' : 'INACTIVE'} size="sm" />
      </td>
      <td className="py-3 pr-4">
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
        {rowError && <div className="mt-2"><ErrorBanner message={rowError} /></div>}
        {confirmingDelete && (
          <ConfirmDialog
            title={`Delete service "${service.serviceName}"?`}
            message="Customers will no longer be able to select this service. This cannot be undone."
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
}: {
  queueId: string;
  services: QueueServiceItem[];
}) {
  const createService = useCreateService(queueId);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState(5);

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
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <ServiceRow key={s.id} queueId={queueId} service={s} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PermissionGate permission="manage_services">
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Add Service
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:max-w-xs">
              <label className="mb-1 block text-xs font-medium text-fg-soft">Service name</label>
              <input
                value={name}
                placeholder="e.g. Consultation, Prescription Pickup"
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-soft">Duration (min)</label>
              <input
                type="number"
                min={1}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-24 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg focus:border-brand-500"
              />
            </div>
            <Button
              disabled={!name}
              loading={createService.isPending}
              onClick={() =>
                createService.mutate(
                  { serviceName: name, durationMinutes: duration },
                  { onSuccess: () => setName('') },
                )
              }
            >
              {createService.isPending ? 'Adding…' : 'Add Service'}
            </Button>
          </div>
        </div>
      </PermissionGate>
    </div>
  );
}

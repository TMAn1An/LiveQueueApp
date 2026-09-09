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
import type { QueueServiceItem } from '../types/queue';

function ServiceRow({ queueId, service }: { queueId: string; service: QueueServiceItem }) {
  const updateService = useUpdateService(queueId);
  const setStatus = useSetServiceStatus(queueId);
  const deleteService = useDeleteService(queueId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(service.serviceName);
  const [duration, setDuration] = useState(service.durationMinutes);
  // V2 Product Completion checkpoint, Part B: this Delete previously called
  // the mutation directly on click, with no way to back out of a mis-click.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    return (
      <tr className="border-b border-border">
        <td className="py-2 pr-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border-strong px-2 py-1 text-sm"
          />
        </td>
        <td className="py-2 pr-4">
          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-20 rounded-md border border-border-strong px-2 py-1 text-sm"
          />
        </td>
        <td className="py-2 pr-4">
          <StatusBadge status={service.isActive ? 'ACTIVE' : 'INACTIVE'} />
        </td>
        <td className="py-2 pr-4 flex gap-2">
          <Button
            loading={updateService.isPending}
            onClick={() =>
              updateService.mutate(
                { serviceId: service.id, input: { serviceName: name, durationMinutes: duration } },
                { onSuccess: () => setEditing(false) },
              )
            }
          >
            {updateService.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border">
      <td className="py-2 pr-4">{service.serviceName}</td>
      <td className="py-2 pr-4">{service.durationMinutes} min</td>
      <td className="py-2 pr-4">
        <StatusBadge status={service.isActive ? 'ACTIVE' : 'INACTIVE'} />
      </td>
      <td className="py-2 pr-4">
        <PermissionGate permission="manage_services">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="secondary"
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate({ serviceId: service.id, isActive: !service.isActive })}
            >
              {setStatus.isPending ? 'Updating…' : service.isActive ? 'Deactivate' : 'Activate'}
            </Button>
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          </div>
        </PermissionGate>
        {confirmingDelete && (
          <ConfirmDialog
            title={`Delete service "${service.serviceName}"?`}
            message="Customers will no longer be able to select this service. This cannot be undone."
            confirming={deleteService.isPending}
            onConfirm={() =>
              deleteService.mutate(service.id, { onSuccess: () => setConfirmingDelete(false) })
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
    <div>
      {services.length === 0 ? (
        <EmptyState message="No services yet." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-faint">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Duration</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <ServiceRow key={s.id} queueId={queueId} service={s} />
            ))}
          </tbody>
        </table>
      )}

      <PermissionGate permission="manage_services">
        <div className="mt-4 flex items-end gap-2 border-t border-border pt-4">
          <div>
            <label className="mb-1 block text-xs text-muted">Service name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-border-strong px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Duration (min)</label>
            <input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-20 rounded-md border border-border-strong px-2 py-1 text-sm"
            />
          </div>
          <Button
            disabled={!name}
            loading={createService.isPending}
            onClick={() =>
              createService.mutate(
                { serviceName: name, durationMinutes: duration },
                // Cleared only on success, so a rejected create keeps what
                // was typed.
                { onSuccess: () => setName('') },
              )
            }
          >
            {createService.isPending ? 'Adding…' : 'Add Service'}
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}

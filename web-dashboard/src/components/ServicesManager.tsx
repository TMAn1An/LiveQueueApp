import { useState } from 'react';
import {
  useCreateService,
  useDeleteService,
  useSetServiceStatus,
  useUpdateService,
} from '../hooks/useServices';
import { Button } from './Button';
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

  if (editing) {
    return (
      <tr className="border-b border-slate-100">
        <td className="py-2 pr-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </td>
        <td className="py-2 pr-4">
          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </td>
        <td className="py-2 pr-4">
          <StatusBadge status={service.isActive ? 'ACTIVE' : 'INACTIVE'} />
        </td>
        <td className="py-2 pr-4 flex gap-2">
          <Button
            onClick={() => {
              updateService.mutate({
                serviceId: service.id,
                input: { serviceName: name, durationMinutes: duration },
              });
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-100">
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
            <Button variant="secondary" onClick={() => setStatus.mutate({ serviceId: service.id, isActive: !service.isActive })}>
              {service.isActive ? 'Deactivate' : 'Activate'}
            </Button>
            <Button variant="danger" onClick={() => deleteService.mutate(service.id)}>
              Delete
            </Button>
          </div>
        </PermissionGate>
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
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
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
        <div className="mt-4 flex items-end gap-2 border-t border-slate-100 pt-4">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Service name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Duration (min)</label>
            <input
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <Button
            disabled={!name || createService.isPending}
            onClick={() => {
              createService.mutate({ serviceName: name, durationMinutes: duration });
              setName('');
            }}
          >
            Add Service
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}

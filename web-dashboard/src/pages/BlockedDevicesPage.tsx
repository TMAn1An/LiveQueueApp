import { useState } from 'react';
import { useDevices, useBlockDevice, useUnblockDevice } from '../hooks/useDevices';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { Pagination } from '../components/Pagination';
import { formatDateTime } from '../utils/format';
import type { CustomerContext, Device, DeviceStatus } from '../types/device';

function CustomerContextPanel({ context }: { context: CustomerContext | null }) {
  if (!context) {
    return <p className="text-xs italic text-slate-400">No recent queue activity.</p>;
  }

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
      {context.formFields.map((field) => (
        <div key={field.key}>
          <dt className="text-slate-400">{field.label}</dt>
          <dd className="text-slate-700">
            {field.type === 'phone' ? (
              <a href={`tel:${field.value}`} className="text-blue-600 hover:underline">
                {field.value}
              </a>
            ) : field.type === 'email' ? (
              <a href={`mailto:${field.value}`} className="text-blue-600 hover:underline">
                {field.value}
              </a>
            ) : (
              field.value
            )}
          </dd>
        </div>
      ))}
      <div>
        <dt className="text-slate-400">Token</dt>
        <dd className="text-slate-700">{context.serialNumber}</dd>
      </div>
      <div>
        <dt className="text-slate-400">Queue</dt>
        <dd className="text-slate-700">{context.queue.name}</dd>
      </div>
      <div>
        <dt className="text-slate-400">Service</dt>
        <dd className="text-slate-700">{context.services.map((s) => s.name).join(', ') || '—'}</dd>
      </div>
      <div>
        <dt className="text-slate-400">Status</dt>
        <dd>
          <StatusBadge status={context.status} />
        </dd>
      </div>
      <div>
        <dt className="text-slate-400">Taken</dt>
        <dd className="text-slate-700">{formatDateTime(context.createdAt)}</dd>
      </div>
    </dl>
  );
}

function DeviceRow({
  device,
  onBlock,
  onUnblock,
}: {
  device: Device;
  onBlock: (deviceId: string) => void;
  onUnblock: (deviceId: string) => void;
}) {
  return (
    <div className="border-b border-slate-100 py-4 last:border-b-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate-500">{device.deviceIdentifier}</span>
          <StatusBadge status={device.status} />
        </div>
        <Button
          variant={device.status === 'ACTIVE' ? 'danger' : 'secondary'}
          onClick={() => (device.status === 'ACTIVE' ? onBlock(device.id) : onUnblock(device.id))}
        >
          {device.status === 'ACTIVE' ? 'Block Device' : 'Unblock Device'}
        </Button>
      </div>

      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Customer / Visit</h3>
      <CustomerContextPanel context={device.customerContext} />

      <p className="mt-2 text-xs text-slate-400">Last seen: {formatDateTime(device.lastSeenAt)}</p>
    </div>
  );
}

export function BlockedDevicesPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | undefined>(undefined);
  const { data: result, isLoading } = useDevices(page, 20, statusFilter);
  const blockDevice = useBlockDevice();
  const unblockDevice = useUnblockDevice();

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold text-slate-900">Blocked Devices</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Devices that have joined one of your queues. Blocking a device only affects your organization
        — it can still be used to join queues at other businesses.
      </p>

      <div className="mb-4 flex gap-2">
        <select
          value={statusFilter ?? ''}
          onChange={(e) => {
            setPage(1);
            setStatusFilter((e.target.value || undefined) as DeviceStatus | undefined);
          }}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="BLOCKED">Blocked</option>
        </select>
      </div>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : !result?.data.length ? (
          <EmptyState message="No devices found." />
        ) : (
          <div>
            {result.data.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                onBlock={(deviceId) => blockDevice.mutate(deviceId)}
                onUnblock={(deviceId) => unblockDevice.mutate(deviceId)}
              />
            ))}
          </div>
        )}
        <Pagination pagination={result?.pagination} onPageChange={setPage} />
      </Card>
    </div>
  );
}

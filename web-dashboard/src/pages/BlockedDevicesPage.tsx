import { useState } from 'react';
import { useDevices, useSetDeviceStatus } from '../hooks/useDevices';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { Pagination } from '../components/Pagination';
import { formatDateTime } from '../utils/format';
import type { DeviceStatus } from '../types/device';

export function BlockedDevicesPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | undefined>(undefined);
  const { data: result, isLoading } = useDevices(page, 20, statusFilter);
  const setDeviceStatus = useSetDeviceStatus();

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold text-slate-900">Blocked Devices</h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Devices are a platform-wide identifier, not tied to a single organization (a customer's phone
        may be used to join queues at more than one business) — this list and blocking action apply
        globally, not only to devices that have used your queues.
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">Device Identifier</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Last Seen</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((device) => (
                <tr key={device.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-mono text-xs">{device.deviceIdentifier}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={device.status} />
                  </td>
                  <td className="py-2 pr-4">{formatDateTime(device.lastSeenAt)}</td>
                  <td className="py-2 pr-4">
                    <Button
                      variant={device.status === 'ACTIVE' ? 'danger' : 'secondary'}
                      onClick={() =>
                        setDeviceStatus.mutate({
                          deviceId: device.id,
                          status: device.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE',
                        })
                      }
                    >
                      {device.status === 'ACTIVE' ? 'Block' : 'Unblock'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination pagination={result?.pagination} onPageChange={setPage} />
      </Card>
    </div>
  );
}

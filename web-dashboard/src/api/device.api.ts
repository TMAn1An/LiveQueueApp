import { apiFetch } from './client';
import type { Device, DeviceStatus } from '../types/device';

export function listDevices(page = 1, pageSize = 20, status?: DeviceStatus) {
  return apiFetch<Device[]>('/api/devices', { query: { page, pageSize, status } });
}

export function setDeviceStatus(deviceId: string, status: DeviceStatus) {
  return apiFetch<Device>(`/api/devices/${deviceId}/status`, { method: 'PATCH', body: { status } });
}

import { apiFetch } from './client';
import type { Device, DeviceStatus } from '../types/device';

export function listDevices(page = 1, pageSize = 20, status?: DeviceStatus, search?: string) {
  return apiFetch<Device[]>('/api/devices', {
    query: { page, pageSize, status, search: search || undefined },
  });
}

export function blockDevice(deviceId: string) {
  return apiFetch<Device>(`/api/devices/${deviceId}/block`, { method: 'POST' });
}

export function unblockDevice(deviceId: string) {
  return apiFetch<Device>(`/api/devices/${deviceId}/block`, { method: 'DELETE' });
}

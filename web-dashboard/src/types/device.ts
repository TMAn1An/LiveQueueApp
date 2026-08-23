export type DeviceStatus = 'ACTIVE' | 'BLOCKED';

export interface Device {
  id: string;
  deviceIdentifier: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

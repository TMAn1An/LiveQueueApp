import type { TokenStatus } from './token';

export type DeviceStatus = 'ACTIVE' | 'BLOCKED';

/** A single dynamic form answer, pre-labeled by the backend from the
 * queue's own QueueFormField definitions — never a guessed "name"/"phone"
 * key (Issue #4: there is no reliable universal customer-field key). */
export interface DisplayFormField {
  key: string;
  label: string;
  type: string;
  value: string;
}

/** The device's most relevant token for this organization: an active one
 * (WAITING/CALLED/IN_PROGRESS) if any exists, else the most recent
 * historical one. `null` when the device has no token for this org. */
export interface CustomerContext {
  tokenId: string;
  serialNumber: string;
  status: TokenStatus;
  queue: { id: string; name: string };
  service: { id: string; name: string };
  formFields: DisplayFormField[];
  createdAt: string;
  calledAt: string | null;
  startedAt: string | null;
}

export interface Device {
  id: string;
  deviceIdentifier: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  customerContext: CustomerContext | null;
}

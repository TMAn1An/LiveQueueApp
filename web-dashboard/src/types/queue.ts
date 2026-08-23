export type QueueStatus = 'ACTIVE' | 'PAUSED' | 'INACTIVE';
export type CounterStatus = 'ACTIVE' | 'ON_BREAK' | 'OFFLINE';
export type FormFieldType =
  | 'text'
  | 'number'
  | 'email'
  | 'phone'
  | 'date'
  | 'dropdown'
  | 'radio'
  | 'checkbox';

export interface QueueServiceItem {
  id: string;
  queueId: string;
  serviceName: string;
  description: string | null;
  durationMinutes: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Queue {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: QueueStatus;
  clientTerminology: string | null;
  tokenPrefix: string;
  startingNumber: number;
  nextTokenNumber: number;
  baseTimeMinutes: number;
  defaultNotificationMinutes: number;
  formVersion: number;
  qrCodeUri: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  services: QueueServiceItem[];
}

export interface Counter {
  id: string;
  queueId: string;
  name: string;
  status: CounterStatus;
  staffId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueFormField {
  id: string;
  queueId: string;
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder: string | null;
  options: string[];
  sortOrder: number;
  version: number;
}

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
  allowRepeatVisits: boolean;
  /** All four are null while repeat visits are allowed. A restricted queue
   * created before ADR-034 also has them null — that is the state the UI
   * flags as needing configuration, since the old device-based rule it was
   * saved under is no longer enforced. */
  repeatRestrictionType: RepeatRestrictionType | null;
  repeatRestrictionAmount: number | null;
  repeatRestrictionUnit: RepeatRestrictionUnit | null;
  /** Absolute instant; the editor shows and edits it on the queue's clock. */
  repeatRestrictionUntil: string | null;
  repeatIdentityMode: RepeatIdentityMode | null;
  repeatIdentityFieldKey: string | null;
  /** IANA name, or null when this queue simply uses its organization's zone
   * (ADR-035). Only a month/year window or a fixed cutoff actually needs one. */
  timezone: string | null;
  allowMultipleServices: boolean;
  formVersion: number;
  qrCodeUri: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  services: QueueServiceItem[];
  /** Only present on the queue-list response (GET /api/queues) — not on single-queue reads. */
  counterCount?: number;
  /** ADR-036 — how this queue alone is doing, for the queue overview. Only
   * present on the queue-list response. */
  waitingCount?: number;
  activeCounterCount?: number;
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

/**
 * A staff member this counter may be assigned to right now — the backend's
 * own availability answer (active, holding no other counter, plus whoever
 * currently holds this one), never a client-side filter over all staff.
 */
export interface AssignableStaff {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * ADR-034 — how a queue that limits repeat visits recognises the customer.
 * Never the app installation: a reinstall must not hand someone a second
 * visit, so the rule is keyed on something the person carries.
 */
export type RepeatRestrictionType = 'ONCE_EVER' | 'DURATION' | 'UNTIL_DATETIME';
export type RepeatRestrictionUnit = 'MINUTE' | 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
export type RepeatIdentityMode =
  | 'VERIFIED_PHONE'
  | 'CUSTOM_FIELD'
  | 'VERIFIED_PHONE_AND_CUSTOM_FIELD';

/** Form-field types that can actually hold an identifier — mirrors the
 * backend's IDENTITY_FIELD_TYPES. A checkbox or a dropdown would collapse
 * everyone who picked the same option into one identity. */
export const IDENTITY_FIELD_TYPES: FormFieldType[] = ['text', 'number', 'email', 'phone'];

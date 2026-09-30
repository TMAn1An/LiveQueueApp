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
  /** ADR-049. QUEUE for every queue that never chose otherwise; optional so a
   * response from an older backend reads as that default. */
  repeatRestrictionScope?: RepeatRestrictionScope;
  /** IANA name, or null when this queue simply uses its organization's zone
   * (ADR-035). Only a month/year window or a fixed cutoff actually needs one. */
  timezone: string | null;
  allowMultipleServices: boolean;
  /** ADR-041: staff must enter the customer's service-start code before
   * starting service. True for every queue that existed before the setting. */
  requireServiceStartOtp: boolean;
  /** Phase 4: false for every queue that predates scheduling (and for every
   * queue that has never turned it on) — joins are accepted at any time,
   * exactly as before this feature existed. */
  scheduleEnabled: boolean;
  /** Total joins allowed per calendar day across every session combined.
   * Null = unlimited. */
  scheduleDailyCapacity: number | null;
  /** Whether the mobile app may show today's hours / the customer's assigned
   * session. Join-failure reasons are shown to the customer either way. */
  scheduleVisibleToCustomers: boolean;
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

/**
 * Phase 4: one recurring weekly time window a queue accepts joins in.
 * `weekday` follows `Date.prototype.getUTCDay()` — 0 (Sunday) through 6
 * (Saturday). `startMinute`/`endMinute` are minutes since local midnight in
 * the queue's own timezone, 0-1439. Overlapping sessions on the same
 * weekday are allowed by design (two concurrent capacity pools), not an
 * accident to warn about.
 */
export interface QueueSession {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  capacity: number | null;
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
/** ADR-049: what one completed visit uses up — the whole queue's allowance,
 * or only the assigned session occurrence's. */
export type RepeatRestrictionScope = 'QUEUE' | 'SESSION';
export type RepeatRestrictionUnit = 'MINUTE' | 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
export type RepeatIdentityMode =
  /** ADR-037: deferred. Still in the union because a queue configured before
   * this can still carry one; never offered, never savable. */
  | 'VERIFIED_PHONE'
  | 'VERIFIED_PHONE_AND_CUSTOM_FIELD'
  | 'VERIFIED_EMAIL'
  | 'CUSTOM_FIELD'
  | 'VERIFIED_EMAIL_AND_CUSTOM_FIELD';

/** The three an administrator may actually choose (ADR-037), in the order
 * they are offered. */
export const SELECTABLE_IDENTITY_MODES: RepeatIdentityMode[] = [
  'VERIFIED_EMAIL',
  'CUSTOM_FIELD',
  'VERIFIED_EMAIL_AND_CUSTOM_FIELD',
];

/** Form-field types that can actually hold an identifier — mirrors the
 * backend's IDENTITY_FIELD_TYPES. A checkbox or a dropdown would collapse
 * everyone who picked the same option into one identity. */
export const IDENTITY_FIELD_TYPES: FormFieldType[] = ['text', 'number', 'email', 'phone'];

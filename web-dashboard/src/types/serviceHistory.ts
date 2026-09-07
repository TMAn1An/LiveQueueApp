import type { DisplayFormField } from './device';

/** Only the three terminal statuses a historical visit can hold. COMPLETED
 * is the default the backend applies when no status is requested — service
 * actually given. */
export type ServiceHistoryStatus = 'COMPLETED' | 'SKIPPED' | 'CANCELLED';

export interface ServiceHistoryEntry {
  tokenId: string;
  serialNumber: string;
  status: ServiceHistoryStatus;
  deviceIdentifier: string;
  queue: { id: string; name: string };
  services: { id: string; name: string; durationMinutes: number }[];
  counter: { id: string; name: string } | null;
  formFields: DisplayFormField[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  cancelledAt: string | null;
  /** Wall-clock minutes between start and completion; null if never started. */
  actualDurationMinutes: number | null;
  /** The staff override when one was set, else the summed service durations. */
  expectedDurationMinutes: number;
}

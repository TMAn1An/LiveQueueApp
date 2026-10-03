import { apiFetch } from './client';
import type {
  Queue,
  QueueStatus,
  RepeatIdentityMode,
  RepeatRestrictionScope,
  RepeatRestrictionType,
  RepeatRestrictionUnit,
} from '../types/queue';

export function listQueues() {
  return apiFetch<Queue[]>('/api/queues');
}

export function getQueue(queueId: string) {
  return apiFetch<Queue>(`/api/queues/${queueId}`);
}

export interface CreateQueueInput {
  name: string;
  description?: string;
  clientTerminology?: string;
  tokenPrefix: string;
  startingNumber?: number;
  baseTimeMinutes?: number;
  defaultNotificationMinutes?: number;
  allowRepeatVisits?: boolean;
  /** ADR-034. Sent together with allowRepeatVisits: false — the backend
   * rejects a restriction that does not say how customers are identified,
   * and clears all four when repeats are allowed again. */
  repeatRestrictionType?: RepeatRestrictionType | null;
  repeatRestrictionAmount?: number | null;
  repeatRestrictionUnit?: RepeatRestrictionUnit | null;
  /** Queue-local wall clock as YYYY-MM-DDTHH:mm — the server converts it to
   * an instant, because only the server knows the queue's zone. */
  repeatRestrictionUntilLocal?: string | null;
  repeatIdentityMode?: RepeatIdentityMode | null;
  repeatIdentityFieldKey?: string | null;
  /** ADR-049. SESSION is refused by the backend while the schedule is off. */
  repeatRestrictionScope?: RepeatRestrictionScope;
  timezone?: string | null;
  /** ADR-055: creation-only. The backend defaults it to true. */
  allowMultipleServices?: boolean;
  /** ADR-055: creation-only, and off unless the creator turns it on. */
  requireServiceStartOtp?: boolean;
  status?: QueueStatus;
  /** Phase 4. Omitted on create — a brand-new queue always starts
   * unscheduled; sessions are added afterward. */
  scheduleEnabled?: boolean;
  scheduleDailyCapacity?: number | null;
  scheduleVisibleToCustomers?: boolean;
  listedOnOrganizationPage?: boolean;
}

export function createQueue(input: CreateQueueInput) {
  return apiFetch<Queue>('/api/queues', { method: 'POST', body: input });
}

/** ADR-055: the two creation-only settings are not part of an update at
 * all — the backend refuses a change with QUEUE_SETTING_IMMUTABLE. */
export type UpdateQueueInput = Omit<
  CreateQueueInput,
  'status' | 'startingNumber' | 'allowMultipleServices' | 'requireServiceStartOtp'
>;

export function updateQueue(queueId: string, input: Partial<UpdateQueueInput>) {
  return apiFetch<Queue>(`/api/queues/${queueId}`, { method: 'PUT', body: input });
}

export function updateQueueStatus(queueId: string, status: QueueStatus) {
  return apiFetch<Queue>(`/api/queues/${queueId}/status`, { method: 'PATCH', body: { status } });
}

export function deleteQueue(queueId: string) {
  return apiFetch<Queue>(`/api/queues/${queueId}`, { method: 'DELETE' });
}

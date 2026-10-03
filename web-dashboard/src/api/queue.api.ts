import { apiFetch } from './client';
import type {
  DeletedQueue,
  Queue,
  RecommendedJourney,
  QueueStatus,
  RepeatIdentityMode,
  RepeatRestrictionScope,
  RepeatRestrictionType,
  RepeatRestrictionUnit,
} from '../types/queue';

/** ADR-069: optionally only one Admin's workspace (Head / Manager filter). */
export function listQueues(adminId?: string) {
  return apiFetch<Queue[]>(adminId ? `/api/queues?adminId=${encodeURIComponent(adminId)}` : '/api/queues');
}

export function getQueue(queueId: string) {
  return apiFetch<Queue>(`/api/queues/${queueId}`);
}

export interface CreateQueueInput {
  name: string;
  description?: string;
  clientTerminology?: string;
  /** Optional: defaults to the name's first letter. */
  tokenPrefix?: string;
  /** ADR-069: the Organization Head names the Admin a queue belongs to; an
   * Admin's own queue is always theirs. */
  adminId?: string;
  /** ADR-069: the queue's first counter and who operates it (default: the
   * queue's Admin). */
  firstCounter?: { name?: string; operatorStaffId?: string };
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

/** ADR-069 D8: always with a reason; refused while anyone is being served. */
export function deleteQueue(queueId: string, reason: string) {
  return apiFetch<Queue>(`/api/queues/${queueId}`, { method: 'DELETE', body: { reason } });
}

export function listDeletedQueues(adminId?: string) {
  return apiFetch<DeletedQueue[]>(
    adminId ? `/api/queues/deleted?adminId=${encodeURIComponent(adminId)}` : '/api/queues/deleted',
  );
}

/** ADR-069: the Organization Head hands a queue to an Admin. */
export function assignQueueAdmin(queueId: string, adminId: string) {
  return apiFetch<Queue>(`/api/queues/${queueId}/admin`, { method: 'PATCH', body: { adminId } });
}

export function getRecommendedJourney(queueId: string) {
  return apiFetch<RecommendedJourney>(`/api/queues/${queueId}/recommended-journey`);
}

export function setRecommendedJourney(queueId: string, serviceIds: string[]) {
  return apiFetch<RecommendedJourney>(`/api/queues/${queueId}/recommended-journey`, {
    method: 'PUT',
    body: { serviceIds },
  });
}

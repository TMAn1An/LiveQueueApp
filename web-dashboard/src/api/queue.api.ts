import { apiFetch } from './client';
import type { Queue, QueueStatus } from '../types/queue';

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
  allowMultipleServices?: boolean;
  status?: QueueStatus;
}

export function createQueue(input: CreateQueueInput) {
  return apiFetch<Queue>('/api/queues', { method: 'POST', body: input });
}

export type UpdateQueueInput = Omit<CreateQueueInput, 'status' | 'startingNumber'>;

export function updateQueue(queueId: string, input: Partial<UpdateQueueInput>) {
  return apiFetch<Queue>(`/api/queues/${queueId}`, { method: 'PUT', body: input });
}

export function updateQueueStatus(queueId: string, status: QueueStatus) {
  return apiFetch<Queue>(`/api/queues/${queueId}/status`, { method: 'PATCH', body: { status } });
}

export function deleteQueue(queueId: string) {
  return apiFetch<Queue>(`/api/queues/${queueId}`, { method: 'DELETE' });
}

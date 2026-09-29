import { apiFetch } from './client';
import type { QueueSession } from '../types/queue';

export interface QueueSessionInput {
  weekday: number;
  startMinute: number;
  endMinute: number;
  capacity: number | null;
}

export function listQueueSessions(queueId: string) {
  return apiFetch<QueueSession[]>(`/api/queues/${queueId}/sessions`);
}

export function createQueueSession(queueId: string, input: QueueSessionInput) {
  return apiFetch<QueueSession>(`/api/queues/${queueId}/sessions`, { method: 'POST', body: input });
}

export function updateQueueSession(queueId: string, sessionId: string, input: QueueSessionInput) {
  return apiFetch<QueueSession>(`/api/queues/${queueId}/sessions/${sessionId}`, {
    method: 'PUT',
    body: input,
  });
}

export function deleteQueueSession(queueId: string, sessionId: string) {
  return apiFetch<void>(`/api/queues/${queueId}/sessions/${sessionId}`, { method: 'DELETE' });
}

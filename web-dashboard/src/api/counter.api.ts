import { apiFetch } from './client';
import type { AssignableStaff, Counter, CounterStatus } from '../types/queue';

export function listCounters(queueId: string) {
  return apiFetch<Counter[]>(`/api/queues/${queueId}/counters`);
}

export function createCounter(queueId: string, name: string) {
  return apiFetch<Counter>(`/api/queues/${queueId}/counters`, { method: 'POST', body: { name } });
}

export function updateCounter(counterId: string, name: string) {
  return apiFetch<Counter>(`/api/counters/${counterId}`, { method: 'PUT', body: { name } });
}

export function setCounterStatus(counterId: string, status: CounterStatus) {
  return apiFetch<Counter>(`/api/counters/${counterId}/status`, { method: 'PATCH', body: { status } });
}

/** `staffId: null` clears the assignment, freeing that person for any counter. */
export function assignCounter(counterId: string, staffId: string | null) {
  return apiFetch<Counter>(`/api/counters/${counterId}/assign`, {
    method: 'PATCH',
    body: { staffId },
  });
}

/** Active staff who hold no counter, plus this counter's current holder. */
export function listAssignableStaff(counterId: string) {
  return apiFetch<AssignableStaff[]>(`/api/counters/${counterId}/available-staff`);
}

export function deleteCounter(counterId: string) {
  return apiFetch<void>(`/api/counters/${counterId}`, { method: 'DELETE' });
}

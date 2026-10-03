import { apiFetch } from './client';
import type { AssignableStaff, Counter, CounterStatus, MyCounter } from '../types/queue';

export function listCounters(queueId: string) {
  return apiFetch<Counter[]>(`/api/queues/${queueId}/counters`);
}

/** ADR-069: with an operator it opens straight away; without one it is OFF. */
export function createCounter(queueId: string, name: string, operatorStaffId?: string) {
  return apiFetch<Counter>(`/api/queues/${queueId}/counters`, {
    method: 'POST',
    body: operatorStaffId ? { name, operatorStaffId } : { name },
  });
}

export function updateCounter(counterId: string, name: string) {
  return apiFetch<Counter>(`/api/counters/${counterId}`, { method: 'PUT', body: { name } });
}

/**
 * ADR-069: OFF releases the operator. Opening or pausing an OFF counter needs
 * one, given here as `operatorStaffId`.
 */
export function setCounterStatus(counterId: string, status: CounterStatus, operatorStaffId?: string) {
  return apiFetch<Counter>(`/api/counters/${counterId}/status`, {
    method: 'PATCH',
    body: operatorStaffId ? { status, operatorStaffId } : { status },
  });
}

/** ADR-070: the services a counter handles; [] = every service. */
export function setCounterServices(counterId: string, serviceIds: string[]) {
  return apiFetch<Counter>(`/api/counters/${counterId}/services`, { method: 'PUT', body: { serviceIds } });
}

/**
 * `staffId: null` clears the assignment, freeing that person for any counter.
 * `move: true` moves someone who holds another counter here, releasing that
 * one in the same step (ADR-064); without it such a request is refused.
 */
export function assignCounter(counterId: string, staffId: string | null, move = false) {
  return apiFetch<Counter>(`/api/counters/${counterId}/assign`, {
    method: 'PATCH',
    body: move ? { staffId, move: true } : { staffId },
  });
}

/** Active staff who hold no counter, plus this counter's current holder. */
export function listAssignableStaff(counterId: string) {
  return apiFetch<AssignableStaff[]>(`/api/counters/${counterId}/available-staff`);
}

export function deleteCounter(counterId: string) {
  return apiFetch<void>(`/api/counters/${counterId}`, { method: 'DELETE' });
}

/** ADR-064: the signed-in person's own counter — the only one they serve at. */
export function getMyCounter() {
  return apiFetch<MyCounter | null>('/api/counters/mine');
}

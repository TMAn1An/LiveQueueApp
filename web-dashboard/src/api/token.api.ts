import { apiFetch } from './client';
import type { StaffToken } from '../types/token';

export function callToken(tokenId: string, counterId: string) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/call`, { method: 'POST', body: { counterId } });
}

// V2 Checkpoint 7 (ADR-029): CALLED -> IN_PROGRESS now requires the
// customer-told verification code — staff can no longer start service with
// a bare click.
export function startToken(tokenId: string, verificationCode: string) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/start`, {
    method: 'POST',
    body: { verificationCode },
  });
}

export function completeToken(tokenId: string) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/complete`, { method: 'POST' });
}

export function skipToken(tokenId: string) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/skip`, { method: 'POST' });
}

export function recallToken(tokenId: string, counterId: string) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/recall`, { method: 'POST', body: { counterId } });
}

export function nextToken(queueId: string, counterId: string) {
  return apiFetch<StaffToken>(`/api/queues/${queueId}/next`, { method: 'POST', body: { counterId } });
}

// V2 Checkpoint 4 (ADR-026): staff override of an active customer's
// required service duration, in minutes.
export function setRequiredDuration(tokenId: string, requiredDurationMinutes: number) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/duration`, {
    method: 'PATCH',
    body: { requiredDurationMinutes },
  });
}

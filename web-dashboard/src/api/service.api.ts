import { apiFetch } from './client';
import type { QueueServiceItem } from '../types/queue';

export interface CreateServiceInput {
  serviceName: string;
  description?: string;
  durationMinutes: number;
  isActive?: boolean;
  /** ADR-070: how often one person's journey may include it (1-10, default 2). */
  maxOccurrencesPerJourney?: number;
}

export function createService(queueId: string, input: CreateServiceInput) {
  return apiFetch<QueueServiceItem>(`/api/queues/${queueId}/services`, {
    method: 'POST',
    body: input,
  });
}

export function updateService(
  serviceId: string,
  input: Partial<Omit<CreateServiceInput, 'isActive'>>,
) {
  return apiFetch<QueueServiceItem>(`/api/services/${serviceId}`, { method: 'PUT', body: input });
}

export function setServiceStatus(serviceId: string, isActive: boolean) {
  return apiFetch<QueueServiceItem>(`/api/services/${serviceId}/status`, {
    method: 'PATCH',
    body: { isActive },
  });
}

export function deleteService(serviceId: string) {
  return apiFetch<void>(`/api/services/${serviceId}`, { method: 'DELETE' });
}

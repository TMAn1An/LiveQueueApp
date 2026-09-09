import { apiFetch } from './client';
import type { Organization } from '../types/auth';

export function getOrganization() {
  return apiFetch<Organization>('/api/organizations/me');
}

export interface UpdateOrganizationInput {
  name?: string;
  /** ADR-035: null clears it back to unset. */
  timezone?: string | null;
}

export function updateOrganization(input: UpdateOrganizationInput) {
  return apiFetch<Organization>('/api/organizations/me', { method: 'PUT', body: input });
}

export function deleteOrganization(confirmName: string) {
  return apiFetch<void>('/api/organizations/me', { method: 'DELETE', body: { confirmName } });
}

/** V2 Product Completion checkpoint, Part C. */
export function completeOnboarding() {
  return apiFetch<Organization>('/api/organizations/me/onboarding/complete', { method: 'POST' });
}

export function restartOnboarding() {
  return apiFetch<Organization>('/api/organizations/me/onboarding/restart', { method: 'POST' });
}

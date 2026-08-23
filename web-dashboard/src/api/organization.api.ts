import { apiFetch } from './client';
import type { Organization } from '../types/auth';

export function getOrganization() {
  return apiFetch<Organization>('/api/organizations/me');
}

export function updateOrganization(name: string) {
  return apiFetch<Organization>('/api/organizations/me', { method: 'PUT', body: { name } });
}

export function deleteOrganization(confirmName: string) {
  return apiFetch<void>('/api/organizations/me', { method: 'DELETE', body: { confirmName } });
}

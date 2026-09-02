import { apiFetch } from './client';
import type { StaffRole, StaffStatus, Staff } from '../types/auth';

/** `search` is omitted from the query string entirely when empty (apiFetch
 * skips undefined), so no-search behaves exactly as before. */
export function listStaff(page = 1, pageSize = 20, search?: string) {
  return apiFetch<Staff[]>('/api/staff', {
    query: { page, pageSize, search: search || undefined },
  });
}

export interface CreateStaffInput {
  name: string;
  email: string;
  password: string;
  role: Exclude<StaffRole, 'OWNER'>;
}

export function createStaff(input: CreateStaffInput) {
  return apiFetch<Staff>('/api/staff', { method: 'POST', body: input });
}

export interface UpdateStaffInput {
  name?: string;
  email?: string;
  password?: string;
  role?: Exclude<StaffRole, 'OWNER'>;
  status?: StaffStatus;
}

export function updateStaff(staffId: string, input: UpdateStaffInput) {
  return apiFetch<Staff>(`/api/staff/${staffId}`, { method: 'PUT', body: input });
}

export function deleteStaff(staffId: string) {
  return apiFetch<void>(`/api/staff/${staffId}`, { method: 'DELETE' });
}

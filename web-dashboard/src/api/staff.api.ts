import { apiFetch } from './client';
import type { Permission, StaffRole, StaffStatus, Staff } from '../types/auth';

export function listStaff(page = 1, pageSize = 20) {
  return apiFetch<Staff[]>('/api/staff', { query: { page, pageSize } });
}

export interface CreateStaffInput {
  name: string;
  email: string;
  password: string;
  role: Exclude<StaffRole, 'OWNER'>;
  permissions: Permission[];
}

export function createStaff(input: CreateStaffInput) {
  return apiFetch<Staff>('/api/staff', { method: 'POST', body: input });
}

export interface UpdateStaffInput {
  name?: string;
  email?: string;
  password?: string;
  role?: Exclude<StaffRole, 'OWNER'>;
  permissions?: Permission[];
  status?: StaffStatus;
}

export function updateStaff(staffId: string, input: UpdateStaffInput) {
  return apiFetch<Staff>(`/api/staff/${staffId}`, { method: 'PUT', body: input });
}

export function deleteStaff(staffId: string) {
  return apiFetch<void>(`/api/staff/${staffId}`, { method: 'DELETE' });
}

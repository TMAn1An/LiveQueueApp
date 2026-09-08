import { apiFetch } from './client';
import type { StaffRole, StaffStatus, Staff } from '../types/auth';

/** `search` is omitted from the query string entirely when empty (apiFetch
 * skips undefined), so no-search behaves exactly as before. */
export function listStaff(page = 1, pageSize = 20, search?: string) {
  return apiFetch<Staff[]>('/api/staff', {
    query: { page, pageSize, search: search || undefined },
  });
}

// ADR-035: no password. The new colleague sets their own through the
// emailed setup link, so nobody else ever knows it.
export interface CreateStaffInput {
  name: string;
  email: string;
  role: Exclude<StaffRole, 'OWNER'>;
}

/** The response says whether the invitation actually reached the provider,
 * so the page can offer Resend instead of claiming it was delivered. */
export type CreatedStaff = Staff & { invitationEmailSent: boolean };

export function createStaff(input: CreateStaffInput) {
  return apiFetch<CreatedStaff>('/api/staff', { method: 'POST', body: input });
}

export function resendStaffInvitation(staffId: string) {
  return apiFetch<{ emailSent: boolean }>(`/api/staff/${staffId}/resend-invitation`, {
    method: 'POST',
  });
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

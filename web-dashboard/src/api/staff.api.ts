import { apiFetch } from './client';
import type {
  MembershipRemovalRequest,
  MembershipRequestStatus,
  Staff,
  StaffRole,
  StaffStatus,
} from '../types/auth';

/** `search` is omitted from the query string entirely when empty (apiFetch
 * skips undefined), so no-search behaves exactly as before. */
export function listStaff(page = 1, pageSize = 20, search?: string, adminId?: string) {
  return apiFetch<Staff[]>('/api/staff', {
    query: { page, pageSize, search: search || undefined, adminId: adminId || undefined },
  });
}

/** ADR-069: the Organization Head places an Executive in an Admin's
 * workspace. ADR-071 D13: always a workspace — never organization-level. */
export function setExecutiveWorkspace(staffId: string, adminId: string | null) {
  return apiFetch<Staff>(`/api/staff/${staffId}/workspace`, { method: 'PATCH', body: { adminId } });
}

// ADR-035: no password. The new colleague sets their own through the
// emailed setup link, so nobody else ever knows it.
export interface CreateStaffInput {
  name: string;
  email: string;
  role: Exclude<StaffRole, 'OWNER'>;
  /** ADR-071 D13: required when the Head invites an Executive; an Admin's
   * invitees always join their own workspace. */
  workspaceAdminId?: string;
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
  /** ADR-071: the destination Admin workspace when making someone an Executive. */
  workspaceAdminId?: string;
}

export function updateStaff(staffId: string, input: UpdateStaffInput) {
  return apiFetch<Staff>(`/api/staff/${staffId}`, { method: 'PUT', body: input });
}

export function deleteStaff(staffId: string) {
  return apiFetch<void>(`/api/staff/${staffId}`, { method: 'DELETE' });
}

// ADR-057: membership removal and leave requests. The request type is
// worked out by the server from who is asking about whom.

export function listRemovalRequests(status?: MembershipRequestStatus) {
  return apiFetch<MembershipRemovalRequest[]>('/api/staff/removal-requests', {
    query: { status },
  });
}

export function createRemovalRequest(input: { targetStaffId: string; reason?: string }) {
  return apiFetch<MembershipRemovalRequest>('/api/staff/removal-requests', {
    method: 'POST',
    body: input,
  });
}

export function reviewRemovalRequest(
  requestId: string,
  decision: 'approve' | 'reject',
  reviewNote?: string,
) {
  return apiFetch<MembershipRemovalRequest>(`/api/staff/removal-requests/${requestId}/${decision}`, {
    method: 'POST',
    body: reviewNote ? { reviewNote } : {},
  });
}

export function cancelRemovalRequest(requestId: string) {
  return apiFetch<MembershipRemovalRequest>(`/api/staff/removal-requests/${requestId}/cancel`, {
    method: 'POST',
  });
}

// ADR-071: Admin workspace handover.

export interface RoleChangeImpact {
  staff: { id: string; name: string; role: StaffRole };
  liveQueue: { id: string; name: string } | null;
  executiveCount: number;
  holdsCounter: boolean;
  activeService: boolean;
  requiresReplacement: boolean;
  eligibleReplacements: { id: string; name: string; email: string; role: StaffRole; workspaceAdminId: string | null }[];
}

export function getRoleChangeImpact(staffId: string) {
  return apiFetch<RoleChangeImpact>(`/api/staff/${staffId}/role-change-impact`);
}

export type TransferOutcome = 'MANAGER' | 'EXECUTIVE' | 'REMOVE';

export interface WorkspaceTransferInput {
  replacementStaffId: string;
  outcome: TransferOutcome;
  reason: string;
  note?: string;
}

export interface WorkspaceTransfer {
  id: string;
  queue: { id: string; name: string } | null;
  oldAdmin: { id: string; name: string; outcome: 'MANAGER' | 'EXECUTIVE' | 'REMOVED' };
  newAdmin: { id: string; name: string; previousRole: StaffRole };
  transferredByName: string;
  reason: string;
  note: string | null;
  executivesMoved: number;
  createdAt: string;
}

export function transferWorkspace(adminId: string, input: WorkspaceTransferInput) {
  return apiFetch<WorkspaceTransfer>(`/api/staff/${adminId}/workspace-transfer`, { method: 'POST', body: input });
}

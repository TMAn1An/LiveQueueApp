/** Mirrors backend/src/constants/permissions.ts — kept in sync manually (separate npm projects). */
export const PERMISSIONS = [
  'manage_organization',
  'manage_staff',
  'manage_queues',
  'manage_services',
  'manage_counters',
  'operate_tokens',
  'view_reports',
  'export_reports',
  'manage_blocked_devices',
  'view_audit_logs',
  // ADR-069
  'view_staff',
  'delete_queues',
  'view_all_workspaces',
  'manage_admins',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Stable role keys (never renamed); what people read is ROLE_LABELS. */
export type StaffRole = 'OWNER' | 'ADMIN' | 'STAFF' | 'MANAGER';

/** ADR-069: the names people see. */
export const ROLE_LABELS: Record<StaffRole, string> = {
  OWNER: 'Organization Head',
  ADMIN: 'Admin',
  STAFF: 'Executive',
  MANAGER: 'Organization Manager',
};

export function roleLabel(role: string | null | undefined): string {
  return role && role in ROLE_LABELS ? ROLE_LABELS[role as StaffRole] : (role ?? '');
}
export type StaffStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_EMAIL_VERIFICATION';
export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED';

export interface Staff {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  permissions?: Permission[];
  /** ADR-069: the Admin workspace an Executive belongs to (null: none). */
  workspaceAdminId?: string | null;
  /** ADR-035: still waiting on an emailed invitation to be accepted. This is
   * what the Resend action keys off; the token itself is never exposed. */
  invitationPending?: boolean;
  invitationSentAt?: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Organization {
  id: string;
  name: string;
  status: OrganizationStatus;
  /** ADR-035: the clock every queue inherits unless it sets its own. */
  timezone?: string | null;
  /** V2 Product Completion checkpoint, Part C: null means the owner has not
   * finished the first-time dashboard tutorial — that is what triggers it. */
  onboardingCompletedAt?: string | null;
  /** ADR-068: the code in the organization's one public QR (/visit/{code}). */
  publicCode?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResult {
  staff: Staff;
  organization: Organization;
  permissions: Permission[];
  accessToken: string;
  refreshToken: string;
}

/** ADR-057: a request for the owner to end someone's membership. */
export type MembershipRequestType = 'SELF_LEAVE' | 'ADMIN_REMOVAL_REQUEST';
export type MembershipRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface MembershipRemovalRequest {
  id: string;
  requestType: MembershipRequestType;
  status: MembershipRequestStatus;
  reason: string | null;
  requester: { id: string; name: string; email: string };
  target: { id: string; name: string; email: string; role: StaffRole };
  reviewedAt: string | null;
  reviewedBy: { id: string; name: string | null } | null;
  reviewNote: string | null;
  createdAt: string;
}

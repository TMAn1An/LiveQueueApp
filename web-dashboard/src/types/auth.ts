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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type StaffRole = 'OWNER' | 'ADMIN' | 'STAFF';
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

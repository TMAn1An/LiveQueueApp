/** Mirrors backend/src/constants/permissions.ts — kept in sync manually (separate npm projects). */
export const PERMISSIONS = [
  'manage_organization',
  'manage_staff',
  'manage_roles',
  'manage_queues',
  'manage_services',
  'manage_counters',
  'operate_tokens',
  'view_reports',
  'export_reports',
  'manage_blocked_devices',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type StaffRole = 'OWNER' | 'ADMIN' | 'ACCOUNTANT';
export type StaffStatus = 'ACTIVE' | 'SUSPENDED';
export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED';

export interface Staff {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  permissions?: Permission[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Organization {
  id: string;
  name: string;
  status: OrganizationStatus;
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

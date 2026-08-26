import type { StaffRole } from '@prisma/client';

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

// Frozen RBAC policy: exactly three roles, each with a fixed permission set.
// OWNER and ADMIN both get full access — the two operations that must stay
// Owner-only (deleting the Owner, deleting the organization) are enforced by
// dedicated role checks elsewhere (staff.service.ts, organization.service.ts),
// never by a permission, per that policy's explicit "hard business rule, not
// a permission check" requirement.
export const OWNER_PERMISSIONS: Permission[] = [...PERMISSIONS];
export const ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];
export const STAFF_PERMISSIONS: Permission[] = [
  'manage_counters',
  'operate_tokens',
  'view_reports',
  'export_reports',
  'manage_blocked_devices',
];

/**
 * The single source of truth for "what can this staff member do." Permissions
 * are derived entirely from role, never from a per-staff stored value — call
 * this everywhere a staff member's authorization is established (the
 * authenticate middleware, auth responses, staff create/update) so no code
 * path can hand out a permission set that doesn't match the caller's actual
 * role, and no stale/arbitrary stored data can override the frozen policy.
 */
export function getEffectivePermissions(role: StaffRole): Permission[] {
  switch (role) {
    case 'OWNER':
      return OWNER_PERMISSIONS;
    case 'ADMIN':
      return ADMIN_PERMISSIONS;
    case 'STAFF':
      return STAFF_PERMISSIONS;
  }
}

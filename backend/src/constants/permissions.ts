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
  // ADR-069
  /** See the people in the organization (scoped: an Admin sees their own
   * workspace; the Organization Head and Managers see everyone). */
  'view_staff',
  /** Remove a queue, always with a reason (an Admin only their own). */
  'delete_queues',
  /** Read every Admin workspace: queues, executives, reports, audit. */
  'view_all_workspaces',
  /** Invite or promote Admins, appoint or remove Organization Managers,
   * and assign legacy queues and executives to Admin workspaces. */
  'manage_admins',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Frozen RBAC policy: exactly three roles, each with a fixed permission set.
// OWNER and ADMIN both get full access — the two operations that must stay
// Owner-only (deleting the Owner, deleting the organization) are enforced by
// dedicated role checks elsewhere (staff.service.ts, organization.service.ts),
// never by a permission, per that policy's explicit "hard business rule, not
// a permission check" requirement.
//
// ADR-064: operate_tokens says a role *may* serve; whether someone actually
// can is decided by their counter assignment (counterAccess.service.ts).
// Every role may serve from the one counter assigned to them.
/** Organization Head: everything (ADR-069 keeps every Owner power). */
export const OWNER_PERMISSIONS: Permission[] = [...PERMISSIONS];
/** Admin: full control of their own workspace only — enforced by the scope
 * checks in workspaceScope.service.ts, not by this list alone. */
export const ADMIN_PERMISSIONS: Permission[] = PERMISSIONS.filter(
  (p) => p !== 'view_all_workspaces' && p !== 'manage_admins',
);
/** Organization Manager (ADR-069): organization-wide read and queue
 * deletion with a reason. No configuration, operations, serving or
 * invitations. */
export const MANAGER_PERMISSIONS: Permission[] = [
  'view_staff',
  'view_reports',
  'export_reports',
  'view_audit_logs',
  'delete_queues',
  'view_all_workspaces',
];
/** Executive: unchanged. */
export const STAFF_PERMISSIONS: Permission[] = [
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
    case 'MANAGER':
      return MANAGER_PERMISSIONS;
  }
}

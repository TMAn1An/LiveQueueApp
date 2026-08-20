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

export const OWNER_PERMISSIONS: Permission[] = [...PERMISSIONS];

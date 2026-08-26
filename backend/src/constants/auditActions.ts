/**
 * The audit event vocabulary (Phase 7 Step 4). `AuditLog.action` is a plain
 * string column (not a Postgres enum — see schema.prisma), validated here at
 * the application layer instead, so new actions never require a migration.
 * Deliberately only the actions actually named for Phase 7 — do not add
 * speculative ones; extend this list only when a real write site needs a
 * new value.
 */
export const AUDIT_ACTIONS = [
  'login',
  'logout',
  'password_changed',
  'staff_created',
  'staff_updated',
  'queue_created',
  'queue_updated',
  'queue_deleted_or_archived',
  'counter_changed',
  'token_called',
  'token_skipped',
  'token_completed',
  'token_recalled',
  'organization_deletion_requested',
  'blocked_device_changed',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

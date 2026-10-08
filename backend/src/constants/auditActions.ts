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
  // ADR-058: a forgot-password link was redeemed.
  'password_reset',
  'email_verified',
  'staff_created',
  'staff_updated',
  // ADR-057: membership removal and the owner-reviewed request workflow.
  'staff_removed',
  'membership_request_created',
  'membership_request_approved',
  'membership_request_rejected',
  'membership_request_cancelled',
  'queue_created',
  'queue_updated',
  'queue_deleted_or_archived',
  'counter_changed',
  'token_called',
  'token_skipped',
  'token_completed',
  // ADR-070: a journey step sent to another counter.
  'token_referred',
  'token_duration_updated',
  'organization_deletion_requested',
  // ADR-071: governance — every one written in the same transaction as the
  // change it records.
  'invitation_accepted',
  'admin_workspace_transferred',
  'head_succession_started',
  'head_succession_verified',
  'head_succession_cancelled',
  'head_succession_declined',
  'head_succession_expired',
  'head_succession_completed',
  'head_tenure_ended',
  'head_tenure_started',
  'staff_sessions_revoked',
  'blocked_device_changed',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

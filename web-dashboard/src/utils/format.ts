export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

/** Minutes since local midnight → "14:00". Session windows are always on the
 * queue's own clock, so this never converts through the browser's zone. */
export function formatMinuteOfDay(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const m = (totalMinutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** "14:00–17:00" for a session window. */
export function formatSessionWindow(window: { startMinute: number; endMinute: number }): string {
  return `${formatMinuteOfDay(window.startMinute)}–${formatMinuteOfDay(window.endMinute)}`;
}

export function formatMinutes(value: number | null): string {
  if (value === null) return '—';
  return `${value} min`;
}

export function formatPercent(value: number): string {
  return `${value}%`;
}

/** ADR-071: actions whose generated label would read wrong — "Staff" is not
 * a word people see (Associates), and governance events deserve plain names. */
const ACTION_LABELS: Record<string, string> = {
  staff_created: 'Associate Invited',
  staff_updated: 'Associate Updated',
  staff_removed: 'Associate Removed',
  staff_sessions_revoked: 'Sessions Ended',
  invitation_accepted: 'Invitation Accepted',
  admin_workspace_transferred: 'Admin Workspace Handed Over',
  head_succession_started: 'Leadership Handover Started',
  head_succession_verified: 'Leadership Handover Confirmed',
  head_succession_cancelled: 'Leadership Handover Cancelled',
  head_succession_declined: 'Leadership Handover Declined',
  head_succession_expired: 'Leadership Handover Expired',
  head_succession_completed: 'Leadership Handover Completed',
  head_tenure_ended: 'Organization Head Tenure Ended',
  head_tenure_started: 'Organization Head Tenure Started',
  queue_deleted_or_archived: 'Queue Deleted',
};

/** "queue_created" -> "Queue Created" — audit action codes are snake_case on
 * the wire; a few read better with an explicit label (ACTION_LABELS). */
export function formatActionLabel(action: string): string {
  const explicit = ACTION_LABELS[action];
  if (explicit) return explicit;
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

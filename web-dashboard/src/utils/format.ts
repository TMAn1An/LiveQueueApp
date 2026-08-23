export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function formatMinutes(value: number | null): string {
  if (value === null) return '—';
  return `${value} min`;
}

export function formatPercent(value: number): string {
  return `${value}%`;
}

/** "staff_created" -> "Staff Created" — audit action codes are snake_case on the wire. */
export function formatActionLabel(action: string): string {
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

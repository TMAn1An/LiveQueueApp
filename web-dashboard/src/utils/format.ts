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

/** "staff_created" -> "Staff Created" — audit action codes are snake_case on the wire. */
export function formatActionLabel(action: string): string {
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

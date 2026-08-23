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

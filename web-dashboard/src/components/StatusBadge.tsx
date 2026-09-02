/** Clear status colors at a glance — operational software, not decoration (spec section 33). */
const COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  WAITING: 'bg-amber-100 text-amber-800',
  CALLED: 'bg-brand-100 text-brand-800',
  IN_PROGRESS: 'bg-accent-100 text-accent-800',
  COMPLETED: 'bg-slate-100 text-slate-600',
  SKIPPED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-orange-100 text-orange-700',
  PAUSED: 'bg-amber-100 text-amber-800',
  INACTIVE: 'bg-slate-100 text-slate-600',
  ON_BREAK: 'bg-amber-100 text-amber-800',
  OFFLINE: 'bg-slate-100 text-slate-600',
  BLOCKED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-red-100 text-red-700',
};

export function StatusBadge({ status }: { status: string }) {
  const classes = COLORS[status] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${classes}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * Modern operational status badges with color + dot indicator (spec section 33).
 * Never relies on color alone; includes clear text and dot indicator.
 */
interface StatusStyle {
  badge: string;
  dot: string;
  pulse?: boolean;
}

const STYLES: Record<string, StatusStyle> = {
  ACTIVE: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60',
    dot: 'bg-emerald-500',
  },
  WAITING: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
    dot: 'bg-amber-500',
  },
  CALLED: {
    badge: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950/50 dark:text-brand-300 dark:border-brand-800/60',
    dot: 'bg-brand-500',
    pulse: true,
  },
  IN_PROGRESS: {
    badge: 'bg-accent-50 text-accent-800 border-accent-200 dark:bg-accent-950/50 dark:text-accent-300 dark:border-accent-800/60',
    dot: 'bg-accent-500',
    pulse: true,
  },
  COMPLETED: {
    badge: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/60',
    dot: 'bg-slate-400',
  },
  SKIPPED: {
    badge: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
    dot: 'bg-rose-500',
  },
  CANCELLED: {
    badge: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/60',
    dot: 'bg-orange-500',
  },
  PAUSED: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
    dot: 'bg-amber-500',
  },
  INACTIVE: {
    badge: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700/60',
    dot: 'bg-slate-400',
  },
  ON_BREAK: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
    dot: 'bg-amber-500',
  },
  OFFLINE: {
    badge: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700/60',
    dot: 'bg-slate-400',
  },
  BLOCKED: {
    badge: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
    dot: 'bg-rose-500',
  },
  SUSPENDED: {
    badge: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
    dot: 'bg-rose-500',
  },
};

const DEFAULT_STYLE: StatusStyle = {
  badge: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
  dot: 'bg-slate-400',
};

export function StatusBadge({
  status,
  size = 'md',
  className = '',
}: {
  status: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const style = STYLES[status] ?? DEFAULT_STYLE;
  const isSm = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors ${
        isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
      } ${style.badge} ${className}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {style.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${style.dot}`}
          />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${style.dot}`} />
      </span>
      <span>{status.replace(/_/g, ' ')}</span>
    </span>
  );
}

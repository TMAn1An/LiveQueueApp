export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-brand-600" />
      <span>{label}</span>
    </div>
  );
}

/**
 * The same spinner sized for a label, a table cell or a control — used
 * wherever an action is in flight but the surrounding content should stay
 * visible. Inherits `currentColor`, so it reads correctly in both themes and
 * against any text color it sits beside.
 */
export function InlineSpinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70 ${className}`}
    />
  );
}

/**
 * A quiet "this data is being refreshed" marker for a list that already has
 * rows on screen — replacing visible results with a full loader on every
 * keystroke would be worse than the wait it reports.
 */
export function RefreshIndicator({ label = 'Updating…' }: { label?: string }) {
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-muted">
      <InlineSpinner />
      {label}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="py-8 text-center text-sm text-muted">{message}</div>;
}

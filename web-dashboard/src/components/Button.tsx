import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

/**
 * One button system for the whole dashboard: every action reads from this
 * table rather than carrying its own colors, so hover, press and disabled
 * feedback are identical everywhere.
 *
 * `danger` deliberately stays red and is the only red variant: it is the one
 * signal separating a destructive action from an ordinary one, and no amount
 * of theming may blur it. Logging out is *not* destructive — it uses
 * `ghost`, not `danger`.
 */
const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow active:bg-brand-800 disabled:bg-brand-300 disabled:shadow-none dark:bg-brand-500 dark:hover:bg-brand-400 dark:active:bg-brand-600 dark:disabled:bg-brand-800 dark:disabled:text-white/60',
  secondary:
    'bg-subtle text-fg hover:bg-border active:bg-border-strong disabled:bg-subtle disabled:text-muted',
  outline:
    'border border-border-strong bg-surface text-fg-soft hover:border-brand-400 hover:text-brand-fg active:bg-subtle disabled:border-border disabled:text-muted',
  ghost:
    'bg-transparent text-fg-soft hover:bg-subtle hover:text-fg active:bg-border disabled:text-faint',
  danger:
    'bg-red-600 text-white shadow-sm hover:bg-red-700 hover:shadow active:bg-red-800 disabled:bg-red-300 disabled:shadow-none dark:disabled:bg-red-900 dark:disabled:text-white/60',
};

/* Pressed feedback is a color/shadow change rather than a transform: a row
   of table actions that jumps on click reads as noise in operational
   software. 150ms is fast enough to feel immediate. */
const BASE_CLASSES =
  'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:shadow-none';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows a spinner and blocks further clicks while an action is in
   * flight. The caller still supplies the wording ("Signing in…"), since
   * only it knows what is happening. */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  className = '',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {loading && <ButtonSpinner />}
      {children}
    </button>
  );
}

function ButtonSpinner() {
  return (
    <span
      aria-hidden="true"
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}

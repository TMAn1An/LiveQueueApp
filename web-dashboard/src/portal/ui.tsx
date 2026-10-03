import type { ReactNode } from 'react';

/** Small shared pieces of the portal's look — mobile-first, large touch targets. */

export function Shell({ title, children, subtitle }: { title?: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-page text-fg">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <img src="/apple-touch-icon.png" alt="" className="h-7 w-7 rounded-md" />
          <span className="text-sm font-bold text-brand-fg">LiveQueue</span>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        {title && <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className={title ? 'mt-4 space-y-4' : 'space-y-4'}>{children}</div>
      </main>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-surface p-4 shadow-xs ${className}`}>{children}</section>;
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  type = 'button',
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-4 text-base font-semibold text-white shadow-xs transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-12 w-full items-center justify-center rounded-xl border border-border-strong bg-surface px-4 text-base font-semibold text-fg disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-fg dark:border-brand-800 dark:bg-brand-950/60',
    warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
    error: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
    ok: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  } as const;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="py-10 text-center text-sm text-muted">
      {label}
    </p>
  );
}

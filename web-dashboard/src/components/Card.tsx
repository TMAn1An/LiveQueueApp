import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface p-5 shadow-xs transition-all duration-150 hover:border-border-strong ${className}`}
    >
      {children}
    </div>
  );
}

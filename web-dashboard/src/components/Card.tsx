import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow duration-150 hover:shadow ${className}`}>
      {children}
    </div>
  );
}

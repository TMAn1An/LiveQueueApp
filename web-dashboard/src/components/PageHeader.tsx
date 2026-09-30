import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  badge,
  breadcrumb,
  actions,
  children,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`mb-6 space-y-4 ${className}`}>
      {breadcrumb && <div>{breadcrumb}</div>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            {typeof title === 'string' ? (
              <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
                {title}
              </h1>
            ) : (
              title
            )}
            {badge && <div className="inline-flex items-center">{badge}</div>}
          </div>
          {description && (
            <p className="mt-1.5 text-sm text-muted">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            {actions}
          </div>
        )}
      </div>
      {children && <div className="pt-1">{children}</div>}
    </div>
  );
}

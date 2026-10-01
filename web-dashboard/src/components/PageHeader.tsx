import type { ReactNode } from 'react';
import { InfoHelp } from './InfoHelp';

export interface PageHeaderProps {
  title: ReactNode;
  /** What the page is for. Not shown under the title: it sits behind the
   * "ⓘ" beside it, so every page opens on its content rather than a sentence
   * about its content. */
  description?: ReactNode;
  /** Completes "More information about …" for the ⓘ. Defaults to the title
   * when that is plain text; needed when it is not, or reads oddly. */
  helpLabel?: string;
  badge?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  helpLabel,
  badge,
  breadcrumb,
  actions,
  children,
  className = '',
}: PageHeaderProps) {
  const label = helpLabel ?? (typeof title === 'string' ? title : 'this page');
  return (
    <div className={`mb-6 space-y-4 ${className}`}>
      {breadcrumb && <div>{breadcrumb}</div>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2.5">
            {typeof title === 'string' ? (
              <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">
                {title}
              </h1>
            ) : (
              title
            )}
            {description && <InfoHelp label={label}>{description}</InfoHelp>}
            {badge && <div className="ml-1.5 inline-flex items-center">{badge}</div>}
          </div>
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

import type { ReactNode } from 'react';
import { InfoHelp } from './InfoHelp';

/**
 * The heading of a card or settings section: the title, an optional "ⓘ" that
 * holds what the section is for, and optional actions on the right.
 *
 * `help` replaces the sentence that used to sit permanently under every
 * section title. Use it for explanation only — a warning, or anything the
 * person needs in order to act safely, belongs on the page, not in here.
 */
export function SectionHeading({
  title,
  help,
  level = 2,
  actions,
  className = '',
}: {
  title: string;
  help?: ReactNode;
  level?: 2 | 3;
  actions?: ReactNode;
  className?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={`mb-4 flex items-center justify-between gap-3 border-b border-border pb-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-0.5">
        <Heading className="text-base font-bold text-fg">{title}</Heading>
        {help && <InfoHelp label={title}>{help}</InfoHelp>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

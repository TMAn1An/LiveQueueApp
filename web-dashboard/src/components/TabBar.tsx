import { Link } from 'react-router-dom';

/**
 * ADR-059: the dashboard's section tabs (Queue Settings, and the queue
 * workspace's Live / Counters / settings strip).
 *
 * Every tab is a bordered, full-size control, so the row reads as a set of
 * choices rather than faint text. The current tab is filled with the brand
 * colour and also carries a check mark and bolder weight, so it is
 * identifiable without colour. It is announced with aria-current. Tabs wrap
 * onto further rows on narrow screens instead of shrinking their text.
 */

export interface TabItem {
  id: string;
  label: string;
  /** A route to navigate to; otherwise `onSelect` is called with the id. */
  to?: string;
}

const BASE =
  'inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border px-4 text-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
const ACTIVE =
  'border-brand-600 bg-brand-600 font-bold text-white shadow-xs dark:border-brand-500 dark:bg-brand-500';
const INACTIVE =
  'border-border-strong bg-surface font-semibold text-fg-soft hover:border-brand-400 hover:bg-subtle hover:text-fg';

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function tabClassName(active: boolean): string {
  return `${BASE} ${active ? ACTIVE : INACTIVE}`;
}

export function TabBar({
  label,
  items,
  activeId,
  onSelect,
  separatorAfter,
}: {
  /** Names the group for assistive technology. */
  label: string;
  items: readonly TabItem[];
  activeId: string | null;
  onSelect?: (id: string) => void;
  /** Draws a divider after this tab id, splitting the row into groups. */
  separatorAfter?: string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap items-center gap-2">
        {items.map((item) => {
          const active = item.id === activeId;
          const content = (
            <>
              {active && <CheckIcon />}
              {item.label}
            </>
          );
          return (
            <li key={item.id} className="flex items-center gap-2">
              {item.to ? (
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={tabClassName(active)}
                >
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelect?.(item.id)}
                  className={tabClassName(active)}
                >
                  {content}
                </button>
              )}
              {separatorAfter === item.id && (
                <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border-strong sm:block" />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

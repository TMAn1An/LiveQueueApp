import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Kept clear of every viewport edge. */
const VIEWPORT_MARGIN = 8;
const MAX_WIDTH = 300;

/**
 * A small "ⓘ" beside a heading that holds the explanation the heading used to
 * carry underneath it. The page stays quiet; the explanation is one hover,
 * focus or tap away.
 *
 * - Mouse: shows while the pointer is over the icon or the explanation.
 * - Keyboard: shows on focus; Enter/Space keeps it open; Escape closes it.
 * - Touch: a tap opens it and it stays until another tap, a tap elsewhere, or
 *   Escape — nothing here depends on hover.
 *
 * The explanation is always in the document (only hidden), and the button
 * points at it with `aria-describedby`, so a screen reader reads it on focus
 * whether or not it is showing.
 *
 * It is positioned against the viewport rather than laid out in the page, so
 * opening it never moves anything, a scrolling or clipping container cannot
 * cut it off, and it is nudged back inside whichever edge it would cross.
 *
 * For explanations only. Anything a person must see to act safely — errors,
 * warnings, consequences of a destructive action — stays on the page.
 */
export function InfoHelp({
  label,
  children,
  className = '',
}: {
  /** What this explains, completing "More information about …". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const helpId = useId();
  const [open, setOpen] = useState(false);
  // Opened deliberately (click, tap, Enter) rather than by passing over it:
  // it then stays until dismissed instead of following the pointer.
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, []);

  const place = useCallback(() => {
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover) return;

    const trigger = button.getBoundingClientRect();
    // clientWidth excludes a vertical scrollbar, which innerWidth does not.
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.max(0, Math.min(MAX_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2));
    popover.style.width = `${width}px`;

    // Start-aligned with the icon, pulled back inside the right-hand edge.
    const left = Math.max(VIEWPORT_MARGIN, Math.min(trigger.left, viewportWidth - width - VIEWPORT_MARGIN));
    // Below the icon, unless there is no room there and there is above.
    const height = popover.offsetHeight;
    const fitsBelow = trigger.bottom + height <= viewportHeight - VIEWPORT_MARGIN;
    const fitsAbove = trigger.top - height >= VIEWPORT_MARGIN;
    const top = fitsBelow || !fitsAbove ? trigger.bottom : trigger.top - height;

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // It is pinned to the viewport, so it has to follow the icon when the
    // page (or any container holding the icon) scrolls or the window resizes.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex shrink-0 align-middle ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={`More information about ${label}`}
        aria-describedby={helpId}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={() => {
          if (pinned) {
            close();
          } else {
            setOpen(true);
            setPinned(true);
          }
        }}
        // The icon is small; the target around it is not. Negative margins
        // keep that larger target from making the heading's row any taller.
        // `text-muted`, not the fainter tone: a control has to clear 3:1
        // against its background in both themes to be findable at all.
        className="-my-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:text-fg-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 aria-expanded:text-fg-soft pointer-coarse:-my-2.5 pointer-coarse:h-10 pointer-coarse:w-10"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 7.5h.01" />
        </svg>
      </button>
      {/* The outer box is transparent padding that touches the icon, so the
          pointer can travel from one to the other without "leaving". */}
      <span
        ref={popoverRef}
        id={helpId}
        role="tooltip"
        hidden={!open}
        className="fixed z-40 py-1.5"
        style={{ maxWidth: MAX_WIDTH }}
      >
        <span className="block rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal whitespace-normal text-fg-soft shadow-lg">
          {children}
        </span>
      </span>
    </span>
  );
}

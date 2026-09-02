import { useEffect, useState } from 'react';

/**
 * Delays propagating a rapidly-changing value (a search box) so the pages
 * backed by server-side listing don't fire one request per keystroke.
 * Deliberately a ~15-line hook rather than a dependency — this is the only
 * debounce this dashboard needs.
 *
 * The timer resets on every change, so the debounced value only settles once
 * typing pauses for `delayMs`.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

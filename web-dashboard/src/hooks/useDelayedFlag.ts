import { useEffect, useState } from 'react';

/**
 * True once `active` has stayed true for `delayMs`, false as soon as it is
 * not. A fast operation therefore never flashes a loader; a slow one gets
 * one after the delay.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => setElapsed(true), delayMs);
    return () => {
      window.clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, delayMs]);
  return active && elapsed;
}

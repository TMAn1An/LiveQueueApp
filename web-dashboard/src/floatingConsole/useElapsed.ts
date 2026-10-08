import { useEffect, useState } from 'react';

/**
 * ADR-072: seconds elapsed since a server timestamp. The timestamp is the
 * authority — reopening, refreshing or reconnecting recomputes the same
 * value. One interval, created only while there is a timestamp and cleared
 * as soon as it goes away or the component unmounts.
 */
export function useElapsedSeconds(since: string | null | undefined): number | null {
  const start = since ? Date.parse(since) : NaN;
  const valid = Number.isFinite(start);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!valid) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [valid, start]);

  if (!valid) return null;
  // The server timestamp is the reference; `now` is at most one tick old.
  return Math.max(0, Math.floor((now - start) / 1000));
}

export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Login / sign-up timing, for measuring how long people wait (ADR-069
 * follow-up). Each attempt is recorded as a Performance API measure —
 * visible in the browser's performance tools as `livequeue:login` or
 * `livequeue:register` — and kept in memory for the session. Nothing is
 * sent anywhere and no personal data is recorded: only the kind, outcome
 * and duration.
 */
export type AuthTimingKind = 'login' | 'register';

export interface AuthTiming {
  kind: AuthTimingKind;
  outcome: 'success' | 'error';
  durationMs: number;
}

const recorded: AuthTiming[] = [];

/** How long the authentication screens wait before showing the loader. */
export const AUTH_LOADER_DELAY_MS = 300;

export function startAuthTiming(kind: AuthTimingKind): (outcome: AuthTiming['outcome']) => AuthTiming {
  const start = performance.now();
  return (outcome) => {
    const durationMs = Math.round(performance.now() - start);
    const timing = { kind, outcome, durationMs };
    recorded.push(timing);
    if (recorded.length > 20) recorded.shift();
    try {
      performance.measure(`livequeue:${kind}`, { start, duration: durationMs, detail: { outcome } });
    } catch {
      // Older engines without measure options: the in-memory record suffices.
    }
    return timing;
  };
}

/** The most recent attempts (newest last). */
export function recentAuthTimings(): readonly AuthTiming[] {
  return recorded;
}

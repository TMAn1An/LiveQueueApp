import { useEffect } from 'react';
import { getApiBaseUrl } from '../api/client';

let warmed = false;

/**
 * ADR-071: on the pages people reach before signing in (register, sign in,
 * invitation, password reset, leadership handover), wake the API in the
 * background so the first real request — a name check, a sign-in — does not
 * also pay for a sleeping host starting up. Fire-and-forget: its result is
 * never read and a failure changes nothing. Once per page load.
 */
export function useBackendWarmup(): void {
  useEffect(() => {
    if (warmed) return;
    warmed = true;
    try {
      // A "simple" GET with no custom headers: no CORS preflight, and
      // no-cors means nothing about the response is read.
      void fetch(`${getApiBaseUrl()}/health`, { mode: 'no-cors', keepalive: true }).catch(() => undefined);
    } catch {
      // A misconfigured base URL is reported by real requests, not here.
    }
  }, []);
}

/** Test-only: allow the next mount to warm up again. */
export function resetBackendWarmupForTests(): void {
  warmed = false;
}

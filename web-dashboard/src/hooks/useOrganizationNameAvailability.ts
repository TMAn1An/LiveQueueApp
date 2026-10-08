import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as authApi from '../api/auth.api';
import { useDebouncedValue } from './useDebouncedValue';
import { LATIN_NAME_PATTERN } from '../utils/latinText';

export type NameAvailability = 'idle' | 'checking' | 'slow' | 'available' | 'taken' | 'unknown';

/** After this long the person is told they can keep going (ADR-071). */
export const NAME_CHECK_SLOW_MS = 2500;
/** After this long the check is abandoned; the server decides on save. */
export const NAME_CHECK_TIMEOUT_MS = 10_000;

/** Same normalization the backend uses for its unique key, so the check here
 * agrees with what registration will decide: case and spacing don't matter. */
export function organizationNameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

class NameCheckTimeout extends Error {}

/**
 * Checks, as the person types, whether an organization name is free —
 * the way a username field does. Waits for typing to pause, never asks for
 * a name too short to register, and treats the organization's own current
 * name (any capitalisation) as available. The backend still decides on save.
 *
 * ADR-071: a slow server (a sleeping host waking up) never holds the form
 * hostage. After 2.5 s the state becomes `slow` ("you can keep filling in
 * the form"); after 10 s the request is cancelled and the state is
 * `unknown`. Never `available` unless the server said so for exactly the
 * name now in the field — a late answer for an earlier name is ignored.
 */
export function useOrganizationNameAvailability(name: string, currentName?: string): NameAvailability {
  const key = organizationNameKey(name);
  const debouncedKey = useDebouncedValue(key, 300);
  const isOwnName = currentName != null && key === organizationNameKey(currentName);
  // ADR-056: a name the backend would refuse anyway is not looked up; the
  // form shows the script error instead of an availability result.
  const latin = LATIN_NAME_PATTERN.test(name);
  const enabled = debouncedKey.length >= 2 && !isOwnName && latin;

  const query = useQuery({
    queryKey: ['organization-name-availability', debouncedKey],
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, NAME_CHECK_TIMEOUT_MS);
      try {
        return (await authApi.checkOrganizationNameAvailability(debouncedKey, controller.signal)).data.available;
      } catch (err) {
        if (timedOut) throw new NameCheckTimeout('Name check timed out');
        throw err;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    },
    enabled,
    staleTime: 10_000,
    retry: false,
  });

  // The "still checking" hint: true once the current request has been in
  // flight for NAME_CHECK_SLOW_MS.
  const [slowFor, setSlowFor] = useState<string | null>(null);
  const fetching = enabled && query.isFetching;
  useEffect(() => {
    if (!fetching) return;
    const timer = setTimeout(() => setSlowFor(debouncedKey), NAME_CHECK_SLOW_MS);
    return () => clearTimeout(timer);
  }, [fetching, debouncedKey]);
  const slow = fetching && slowFor === debouncedKey;

  if (key.length < 2 || !latin) return 'idle';
  if (isOwnName) return 'available';
  if (key !== debouncedKey) return 'checking';
  if (query.isFetching) return slow ? 'slow' : 'checking';
  if (query.isError) return 'unknown';
  if (query.data === undefined) return 'checking';
  return query.data ? 'available' : 'taken';
}

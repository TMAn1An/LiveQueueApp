import { useQuery } from '@tanstack/react-query';
import * as authApi from '../api/auth.api';
import { useDebouncedValue } from './useDebouncedValue';
import { LATIN_NAME_PATTERN } from '../utils/latinText';

export type NameAvailability = 'idle' | 'checking' | 'available' | 'taken' | 'unknown';

/** Same normalization the backend uses for its unique key, so the check here
 * agrees with what registration will decide: case and spacing don't matter. */
export function organizationNameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Checks, as the person types, whether an organization name is free —
 * the way a username field does. Waits for typing to pause, never asks for
 * a name too short to register, and treats the organization's own current
 * name (any capitalisation) as available. The backend still decides on save.
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
    queryFn: async () => (await authApi.checkOrganizationNameAvailability(debouncedKey)).data.available,
    enabled,
    staleTime: 10_000,
    retry: false,
  });

  if (key.length < 2 || !latin) return 'idle';
  if (isOwnName) return 'available';
  if (key !== debouncedKey || query.isFetching) return 'checking';
  if (query.isError) return 'unknown';
  if (query.data === undefined) return 'checking';
  return query.data ? 'available' : 'taken';
}

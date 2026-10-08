import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * ADR-074: coalesces cache invalidations that arrive in a burst.
 *
 * One queue change makes the server send `token.position_changed` once per
 * waiting person, and each event used to invalidate (and so refetch) the same
 * views again. With 500 people waiting, one "Serve next" cost about 1,000
 * requests per open tab. Here every key requested during a short quiet
 * window is invalidated once when the burst ends. The server is still the
 * source of truth: the refetch still happens, just once per burst.
 *
 * The window restarts with each new request (`QUIET_MS`), but is never held
 * open longer than `MAX_WAIT_MS` from the first, so a steady stream of
 * events still refreshes the screen regularly.
 */
export const QUIET_MS = 100;
export const MAX_WAIT_MS = 1_000;

export interface InvalidationScheduler {
  /** Invalidate `queryKey` (and everything under it) when the burst ends. */
  schedule(queryKey: QueryKey): void;
  /** Invalidate everything scheduled so far, now. */
  flush(): void;
  /** Drop anything scheduled without invalidating it. */
  cancel(): void;
}

export function createInvalidationScheduler(
  queryClient: QueryClient,
  quietMs = QUIET_MS,
  maxWaitMs = MAX_WAIT_MS,
): InvalidationScheduler {
  const pending = new Map<string, QueryKey>();
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers() {
    if (quietTimer) clearTimeout(quietTimer);
    if (maxTimer) clearTimeout(maxTimer);
    quietTimer = null;
    maxTimer = null;
  }

  function flush() {
    clearTimers();
    const keys = [...pending.values()];
    pending.clear();
    // Invalidation matches by prefix, so a key already covered by a shorter
    // scheduled key (['dashboard','stats'] under ['dashboard']) is skipped.
    for (const key of keys) {
      const covered = keys.some(
        (other) => other.length < key.length && hashKey(key.slice(0, other.length)) === hashKey(other),
      );
      if (!covered) void queryClient.invalidateQueries({ queryKey: key });
    }
  }

  return {
    schedule(queryKey) {
      pending.set(hashKey(queryKey), queryKey);
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(flush, quietMs);
      if (!maxTimer) maxTimer = setTimeout(flush, maxWaitMs);
    },
    flush,
    cancel() {
      clearTimers();
      pending.clear();
    },
  };
}

const schedulers = new WeakMap<QueryClient, InvalidationScheduler>();

/**
 * The scheduler shared by everything using this QueryClient — the
 * organization socket and the token mutations — so a mutation's own
 * refresh and the broadcast it causes land in the same single refetch.
 */
export function invalidationSchedulerFor(queryClient: QueryClient): InvalidationScheduler {
  let scheduler = schedulers.get(queryClient);
  if (!scheduler) {
    scheduler = createInvalidationScheduler(queryClient);
    schedulers.set(queryClient, scheduler);
  }
  return scheduler;
}

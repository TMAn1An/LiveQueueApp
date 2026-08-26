/**
 * V2 Checkpoint 4 (ADR-026). Pure computation, no I/O — token.service.ts
 * supplies the current DB state, this module turns it into ETAs. Kept
 * separate from token.service.ts specifically so the scheduling algorithm
 * itself is unit-testable without a database.
 *
 * Replaces the V1/V2-Checkpoint-1..3 approximation
 * (`ceil(currentTokenDuration × position / activeCounters)`, which used the
 * *querying* token's own duration as a stand-in for every token ahead of
 * it) with a real multi-server FCFS scheduling simulation: N counters each
 * become free at a known time; waiting tokens are assigned to whichever
 * counter frees up soonest, in strict arrival order; each token's own
 * actual service duration determines when the counter it lands on becomes
 * free for the next one. This is a standard "N identical machines,
 * FCFS, known job durations" model — not a heuristic.
 */

/** Standing V2 rule: default auto-extension when a service's allocated time
 * expires without a further staff update. A named constant, not a magic
 * number — see CLAUDE.md/ADR-023's "prefer a named constant" guidance. */
export const DEFAULT_SERVICE_EXTENSION_MINUTES = 2;

/**
 * `requiredDurationMinutes` (staff override) is authoritative whenever set;
 * otherwise the service's own configured duration applies. This is the one
 * function both a CALLED/IN_PROGRESS token's "when will this counter free
 * up" calculation and — once multi-service selection exists — a future
 * checkpoint's total-duration calculation should both go through.
 */
export function computeEffectiveDurationMinutes(
  requiredDurationMinutes: number | null | undefined,
  serviceDurationMinutes: number,
): number {
  return requiredDurationMinutes ?? serviceDurationMinutes;
}

/**
 * The default +2-minute auto-extension: if a service's allocated time has
 * already expired and staff hasn't set a new required duration, the
 * expectation keeps rolling forward in fixed increments rather than
 * freezing in the past (which would make a still-in-progress service look
 * "free" to the simulation below, wrongly promising an already-broken ETA
 * to everyone behind it). Computed fresh every call from `anchor` +
 * `durationMinutes` + `now` — nothing about this is persisted; there is
 * nothing to "expire" in storage, only in what this function returns next
 * time it's asked.
 */
export function computeEffectiveEndTime(anchor: Date, durationMinutes: number, now: Date): Date {
  const baseEndMs = anchor.getTime() + durationMinutes * 60_000;
  if (now.getTime() < baseEndMs) {
    return new Date(baseEndMs);
  }
  const extensionMs = DEFAULT_SERVICE_EXTENSION_MINUTES * 60_000;
  const overdueMs = now.getTime() - baseEndMs;
  const extensions = Math.floor(overdueMs / extensionMs) + 1;
  return new Date(baseEndMs + extensions * extensionMs);
}

export interface CounterOccupancy {
  /** When this counter is expected to next become free. `now` if it isn't
   * currently serving anyone. */
  freeAt: Date;
}

export interface WaitingTokenInput {
  id: string;
  /** This token's own effective duration (computeEffectiveDurationMinutes) —
   * WAITING tokens aren't staff-overridable this checkpoint (only "active"
   * ones are, per the product requirement), so this is always the
   * service's own durationMinutes for now; the parameter stays generic so a
   * future multi-service checkpoint can pass a summed total here instead. */
  durationMinutes: number;
}

/**
 * The simulation itself: repeatedly assigns the next WAITING token (already
 * in strict FCFS order — callers must pass them pre-sorted by
 * sequenceNumber) to whichever counter frees up soonest, then advances that
 * counter's free time by the assigned token's own duration. Returns each
 * token's estimated "called at" timestamp, in the same order.
 *
 * O(waitingTokens × counters) — counter counts are always small (a handful
 * per queue in practice), so a linear scan for the minimum each iteration
 * is simpler and plenty fast; no need for a heap.
 */
export function simulateWaitingTokenEtas(
  counters: CounterOccupancy[],
  waitingTokens: WaitingTokenInput[],
): Map<string, Date> {
  const result = new Map<string, Date>();
  if (counters.length === 0) {
    return result;
  }

  const freeAtMs = counters.map((c) => c.freeAt.getTime());

  for (const token of waitingTokens) {
    let earliestIndex = 0;
    for (let i = 1; i < freeAtMs.length; i++) {
      if (freeAtMs[i]! < freeAtMs[earliestIndex]!) {
        earliestIndex = i;
      }
    }
    const readyAtMs = freeAtMs[earliestIndex]!;
    result.set(token.id, new Date(readyAtMs));
    freeAtMs[earliestIndex] = readyAtMs + token.durationMinutes * 60_000;
  }

  return result;
}

/** `estimatedWaitMinutes` is derived from `estimatedReadyAt`, never computed
 * independently — one number, one source, matching every other "compute at
 * read time" field in this codebase. Clamped to zero rather than negative
 * (a slightly-stale read shouldn't show "-1 minutes"). */
export function minutesUntil(target: Date, now: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 60_000));
}

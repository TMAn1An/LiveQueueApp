/**
 * The IANA zone this browser is set to (ADR-035).
 *
 * Used only to *initialize* an organization's timezone at registration, and
 * to suggest one when a queue has none. It is the timezone of whoever is
 * sitting at the computer — which is usually, but not always, where the queue
 * physically runs — so it is offered as a starting value that settings can
 * correct, never presented as an authoritative fact about the queue.
 *
 * Never guessed from IP, and never taken from a customer's phone: a queue's
 * clock is a property of the queue.
 */
export function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Every zone this runtime knows, for the override picker. Null when the
 * engine is too old to enumerate them, in which case the caller falls back to
 * a free-text field rather than a short hardcoded list.
 *
 * `Intl.supportedValuesOf` lists regional zones only and leaves out "UTC",
 * which is nevertheless a valid zone everywhere and a common choice — so it
 * is put first here. */
export function supportedTimezones(): string[] | null {
  const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  if (typeof supported !== 'function') return null;
  try {
    const zones = supported('timeZone');
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return null;
  }
}

/** The choices for a zone picker that may be showing any of `inUse` — the
 * stored zone, an inherited one, this device's.
 *
 * A zone can be perfectly valid and still missing from this browser's list:
 * browsers disagree on aliases ("Asia/Kolkata" vs "Asia/Calcutta"). Without
 * its own option a `<select>` displays its first entry ("Not set") for a zone
 * that is in fact set, so each one is given an option. */
export function timezoneOptions(zones: string[], ...inUse: (string | null | undefined)[]): string[] {
  const missing = inUse.filter((zone): zone is string => Boolean(zone) && !zones.includes(zone as string));
  return missing.length === 0 ? zones : [...new Set(missing), ...zones];
}

/** How a moment reads on a particular clock, e.g. "8 Oct, 10:00". */
export function formatInZone(instant: Date, timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone || undefined,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(instant);
  } catch {
    return instant.toLocaleString();
  }
}

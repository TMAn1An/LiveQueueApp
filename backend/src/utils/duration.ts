const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/** Parses simple duration strings like "15m", "30d", "12h" into milliseconds. */
export function parseDurationToMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d|w)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}"`);
  }
  const amount = Number(match[1]);
  const unitMs = UNIT_MS[match[2] as string];
  if (unitMs === undefined) {
    throw new Error(`Invalid duration unit in: "${duration}"`);
  }
  return amount * unitMs;
}

export interface DateRange {
  from: Date;
  to: Date;
}

function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** "Today" boundary for the dashboard's own-day stats (completed/skipped today). */
export function todayRange(): DateRange {
  const from = startOfUtcDay(new Date());
  const to = new Date();
  return { from, to };
}

export type ReportRangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

/**
 * Spec section 13's five date filters. `custom` requires both `from`/`to`
 * to already be validated (Zod) before reaching here.
 */
export function resolveReportRange(
  preset: ReportRangePreset,
  custom?: { from?: Date; to?: Date },
): DateRange {
  const now = new Date();
  const todayStart = startOfUtcDay(now);

  switch (preset) {
    case 'today':
      return { from: todayStart, to: now };
    case 'yesterday': {
      const from = new Date(todayStart);
      from.setUTCDate(from.getUTCDate() - 1);
      return { from, to: todayStart };
    }
    case 'last7': {
      const from = new Date(todayStart);
      from.setUTCDate(from.getUTCDate() - 7);
      return { from, to: now };
    }
    case 'last30': {
      const from = new Date(todayStart);
      from.setUTCDate(from.getUTCDate() - 30);
      return { from, to: now };
    }
    case 'custom':
      return { from: custom?.from ?? todayStart, to: custom?.to ?? now };
  }
}

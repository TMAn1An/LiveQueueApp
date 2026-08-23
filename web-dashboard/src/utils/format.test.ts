import { describe, expect, it } from 'vitest';
import { formatDateTime, formatMinutes, formatPercent } from './format';

describe('formatDateTime', () => {
  it('returns an em dash for null', () => {
    expect(formatDateTime(null)).toBe('—');
  });

  it('formats an ISO string via toLocaleString', () => {
    const iso = '2026-01-01T12:00:00.000Z';
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
  });
});

describe('formatMinutes', () => {
  it('returns an em dash for null (e.g. zero active counters)', () => {
    expect(formatMinutes(null)).toBe('—');
  });

  it('formats a numeric minute value', () => {
    expect(formatMinutes(5)).toBe('5 min');
  });

  it('formats zero minutes distinctly from null', () => {
    expect(formatMinutes(0)).toBe('0 min');
  });
});

describe('formatPercent', () => {
  it('appends a percent sign', () => {
    expect(formatPercent(42.5)).toBe('42.5%');
  });
});

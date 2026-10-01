import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportedTimezones, timezoneOptions } from './timezone';

const intl = Intl as unknown as { supportedValuesOf: (key: string) => string[] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('supportedTimezones', () => {
  it('offers UTC, which Intl.supportedValuesOf leaves out', () => {
    vi.spyOn(intl, 'supportedValuesOf').mockReturnValue(['Asia/Dhaka', 'Europe/London']);

    expect(supportedTimezones()).toEqual(['UTC', 'Asia/Dhaka', 'Europe/London']);
  });

  it('does not list UTC twice on a runtime that already includes it', () => {
    vi.spyOn(intl, 'supportedValuesOf').mockReturnValue(['Asia/Dhaka', 'UTC']);

    expect(supportedTimezones()).toEqual(['Asia/Dhaka', 'UTC']);
  });
});

describe('timezoneOptions', () => {
  const zones = ['UTC', 'Asia/Calcutta', 'Asia/Dhaka'];

  it('returns the list untouched when every zone in use is already in it', () => {
    expect(timezoneOptions(zones, 'UTC', 'Asia/Dhaka', null, undefined)).toBe(zones);
  });

  it('adds a stored zone this browser does not list, so it is never shown as "Not set"', () => {
    expect(timezoneOptions(zones, 'Asia/Kolkata')).toEqual(['Asia/Kolkata', ...zones]);
  });

  it('adds each missing zone once', () => {
    expect(timezoneOptions(zones, 'Asia/Kolkata', 'Asia/Kolkata', 'Etc/GMT+5')).toEqual([
      'Asia/Kolkata',
      'Etc/GMT+5',
      ...zones,
    ]);
  });
});

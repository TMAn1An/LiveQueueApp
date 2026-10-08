import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { formatElapsed, useElapsedSeconds } from './useElapsed';

afterEach(() => vi.useRealTimers());

describe('useElapsedSeconds (ADR-072)', () => {
  it('counts from the server timestamp', () => {
    vi.useFakeTimers();
    const since = new Date(Date.now() - 90_000).toISOString();
    const { result } = renderHook(() => useElapsedSeconds(since));
    expect(result.current).toBe(90);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(92);
  });

  it('keeps exactly one interval, and none once the timestamp is gone or it unmounts', () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(({ since }) => useElapsedSeconds(since), {
      initialProps: { since: new Date().toISOString() as string | null },
    });
    expect(vi.getTimerCount()).toBe(1);
    rerender({ since: new Date(Date.now() - 5000).toISOString() });
    expect(vi.getTimerCount()).toBe(1);
    rerender({ since: null });
    expect(vi.getTimerCount()).toBe(0);
    rerender({ since: new Date().toISOString() });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is null without a valid timestamp', () => {
    expect(renderHook(() => useElapsedSeconds(null)).result.current).toBeNull();
    expect(renderHook(() => useElapsedSeconds('not a date')).result.current).toBeNull();
  });

  it('formats minutes and hours', () => {
    expect(formatElapsed(5)).toBe('0:05');
    expect(formatElapsed(125)).toBe('2:05');
    expect(formatElapsed(3725)).toBe('1:02:05');
  });
});

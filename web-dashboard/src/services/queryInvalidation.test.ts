import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createInvalidationScheduler, invalidationSchedulerFor } from './queryInvalidation';

describe('createInvalidationScheduler (ADR-074)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient();
    vi.spyOn(queryClient, 'invalidateQueries');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const keys = () => vi.mocked(queryClient.invalidateQueries).mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));

  it('invalidates each distinct key once when the burst goes quiet', () => {
    const scheduler = createInvalidationScheduler(queryClient, 100, 1000);
    for (let i = 0; i < 1000; i++) {
      scheduler.schedule(['dashboard']);
      scheduler.schedule(['queue', 'q1']);
    }
    vi.advanceTimersByTime(99);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(keys()).toEqual(['["dashboard"]', '["queue","q1"]']);
  });

  it('skips a key already covered by a scheduled prefix, but not a sibling', () => {
    const scheduler = createInvalidationScheduler(queryClient, 100, 1000);
    scheduler.schedule(['dashboard', 'stats']);
    scheduler.schedule(['dashboard']);
    scheduler.schedule(['queue', 'q1']);
    scheduler.schedule(['queues']);
    scheduler.flush();
    expect(keys().sort()).toEqual(['["dashboard"]', '["queue","q1"]', '["queues"]']);
  });

  it('caps the wait from the first request at maxWaitMs', () => {
    const scheduler = createInvalidationScheduler(queryClient, 100, 300);
    for (let t = 0; t < 300; t += 50) {
      scheduler.schedule(['dashboard']);
      vi.advanceTimersByTime(50);
    }
    expect(keys()).toEqual(['["dashboard"]']);
  });

  it('cancel drops pending keys', () => {
    const scheduler = createInvalidationScheduler(queryClient, 100, 1000);
    scheduler.schedule(['dashboard']);
    scheduler.cancel();
    vi.advanceTimersByTime(2000);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('is shared per QueryClient', () => {
    expect(invalidationSchedulerFor(queryClient)).toBe(invalidationSchedulerFor(queryClient));
    expect(invalidationSchedulerFor(queryClient)).not.toBe(invalidationSchedulerFor(new QueryClient()));
  });
});

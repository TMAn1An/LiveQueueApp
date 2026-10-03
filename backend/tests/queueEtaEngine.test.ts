import { describe, expect, it } from 'vitest';
import {
  computeEffectiveDurationMinutes,
  computeEffectiveEndTime,
  minutesUntil,
  simulateRoutedEtas,
  simulateWaitingTokenEtas,
} from '../src/services/queueEtaEngine';

const NOW = new Date('2026-01-01T10:00:00.000Z');
const min = (n: number) => n * 60_000;

describe('computeEffectiveDurationMinutes', () => {
  it('uses the staff override when set', () => {
    expect(computeEffectiveDurationMinutes(18, 10)).toBe(18);
  });

  it('falls back to the service duration when no override is set', () => {
    expect(computeEffectiveDurationMinutes(null, 10)).toBe(10);
    expect(computeEffectiveDurationMinutes(undefined, 10)).toBe(10);
  });
});

describe('computeEffectiveEndTime', () => {
  it('returns anchor + duration when that time has not yet passed', () => {
    const anchor = new Date(NOW.getTime() - min(5));
    const end = computeEffectiveEndTime(anchor, 10, NOW);
    expect(end.getTime()).toBe(anchor.getTime() + min(10));
  });

  it('extends by exactly one +2min increment just past expiry', () => {
    const anchor = new Date(NOW.getTime() - min(10) - 1); // baseEnd is 1ms in the past
    const end = computeEffectiveEndTime(anchor, 10, NOW);
    expect(end.getTime()).toBe(anchor.getTime() + min(10) + min(2));
  });

  it('rolls forward multiple +2min increments for a long-overdue service', () => {
    const anchor = new Date(NOW.getTime() - min(10) - min(5)); // 5 minutes overdue
    const end = computeEffectiveEndTime(anchor, 10, NOW);
    // baseEnd = anchor+10min = now-5min (overdue by 5min) -> ceil to the next 2min boundary: +6min from baseEnd
    expect(end.getTime()).toBeGreaterThan(NOW.getTime());
    expect(end.getTime()).toBe(anchor.getTime() + min(10) + min(6));
  });
});

describe('simulateWaitingTokenEtas', () => {
  it('a single free counter serves waiting tokens back to back in order', () => {
    const result = simulateWaitingTokenEtas(
      [{ freeAt: NOW }],
      [
        { id: 'a1', durationMinutes: 10 },
        { id: 'a2', durationMinutes: 5 },
      ],
    );
    expect(result.get('a1')!.getTime()).toBe(NOW.getTime());
    expect(result.get('a2')!.getTime()).toBe(NOW.getTime() + min(10));
  });

  it('two free counters serve the first two waiting tokens in parallel, not divided by two', () => {
    const result = simulateWaitingTokenEtas(
      [{ freeAt: NOW }, { freeAt: NOW }],
      [
        { id: 'a1', durationMinutes: 10 },
        { id: 'a2', durationMinutes: 20 },
        { id: 'a3', durationMinutes: 5 },
      ],
    );
    expect(result.get('a1')!.getTime()).toBe(NOW.getTime());
    expect(result.get('a2')!.getTime()).toBe(NOW.getTime());
    // a3 goes to whichever counter frees first: counter 1 (10min), not a flat position/counters average.
    expect(result.get('a3')!.getTime()).toBe(NOW.getTime() + min(10));
  });

  it('a counter already busy delays the token assigned to it, using the real occupying-token duration', () => {
    const result = simulateWaitingTokenEtas(
      [{ freeAt: new Date(NOW.getTime() + min(15)) }, { freeAt: NOW }],
      [{ id: 'a1', durationMinutes: 5 }],
    );
    // The free counter (index 1) is earlier than the busy one, so a1 is served there immediately.
    expect(result.get('a1')!.getTime()).toBe(NOW.getTime());
  });

  it('returns an empty result when there are no active counters', () => {
    const result = simulateWaitingTokenEtas([], [{ id: 'a1', durationMinutes: 5 }]);
    expect(result.size).toBe(0);
  });

  it('a staff duration override on the in-service token shifts every downstream ETA', () => {
    const shortOccupancy = simulateWaitingTokenEtas(
      [{ freeAt: new Date(NOW.getTime() + min(10)) }],
      [{ id: 'a1', durationMinutes: 5 }],
    );
    const longOccupancy = simulateWaitingTokenEtas(
      [{ freeAt: new Date(NOW.getTime() + min(25)) }], // staff extended the current customer to 25min
      [{ id: 'a1', durationMinutes: 5 }],
    );
    expect(longOccupancy.get('a1')!.getTime()).toBeGreaterThan(shortOccupancy.get('a1')!.getTime());
    expect(longOccupancy.get('a1')!.getTime() - shortOccupancy.get('a1')!.getTime()).toBe(min(15));
  });
});

describe('simulateRoutedEtas (ADR-070)', () => {
  const now = new Date('2026-10-03T10:00:00Z');
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  const free = (id: string, serviceIds: string[] | null = null, freeAt = now) => ({
    id,
    freeAt,
    serviceIds: serviceIds ? new Set(serviceIds) : null,
  });
  const waiting = (id: string, serviceId: string | null, durationMinutes: number, extra = {}) => ({
    id,
    serviceId,
    durationMinutes,
    boundCounterId: null,
    referredAt: null,
    ...extra,
  });

  it('matches simulateWaitingTokenEtas when nothing is routed', () => {
    const counters = [free('c1'), free('c2', null, at(4))];
    const tokens = [waiting('a', null, 5), waiting('b', null, 3), waiting('c', null, 7)];
    const routed = simulateRoutedEtas(counters, tokens);
    const plain = simulateWaitingTokenEtas(counters, tokens);
    expect([...routed.entries()]).toEqual([...plain.entries()]);
  });

  it('gives a counter only the services it handles', () => {
    const result = simulateRoutedEtas(
      [free('reg', ['R']), free('pay', ['P'])],
      [waiting('a', 'R', 5), waiting('b', 'R', 5), waiting('c', 'P', 5)],
    );
    expect(result.get('a')).toEqual(now);
    expect(result.get('b')).toEqual(at(5));
    expect(result.get('c')).toEqual(now);
  });

  it('counts the later steps of someone being served toward those behind them', () => {
    // One counter; X is at it for step 1 until +10 and then needs step 2 (7
    // min) — arrival order puts X's step 2 ahead of B.
    const result = simulateRoutedEtas(
      [free('c1', null, at(10))],
      [
        waiting('x', 'S2', 7, { sequence: 1, availableAt: at(10), inService: true }),
        waiting('b', 'S1', 10, { sequence: 2 }),
      ],
    );
    expect(result.get('b')).toEqual(at(17));
    expect(result.has('x')).toBe(false);
  });

  it('lets a counter take someone later in line while an earlier person is still elsewhere', () => {
    // X is at Registration until +10 and needs Payment next; B wants Payment now.
    const result = simulateRoutedEtas(
      [free('reg', ['R'], at(10)), free('pay', ['P'])],
      [
        waiting('x', 'P', 5, { sequence: 1, availableAt: at(10), inService: true }),
        waiting('b', 'P', 5, { sequence: 2 }),
      ],
    );
    expect(result.get('b')).toEqual(now);
  });

  it('puts a referral first at its counter, and gives no estimate to whom no counter can serve', () => {
    const result = simulateRoutedEtas(
      [free('pay', ['P'])],
      [
        waiting('a', 'P', 5, { sequence: 1 }),
        waiting('x', 'P', 5, { sequence: 2, boundCounterId: 'pay', referredAt: now }),
        waiting('z', 'Q', 5, { sequence: 3 }),
      ],
    );
    expect(result.get('x')).toEqual(now);
    expect(result.get('a')).toEqual(at(5));
    expect(result.has('z')).toBe(false);
  });
});

describe('minutesUntil', () => {
  it('rounds up to the nearest whole minute', () => {
    expect(minutesUntil(new Date(NOW.getTime() + 30_000), NOW)).toBe(1);
    expect(minutesUntil(new Date(NOW.getTime() + min(5)), NOW)).toBe(5);
  });

  it('clamps a past timestamp to zero rather than a negative number', () => {
    expect(minutesUntil(new Date(NOW.getTime() - min(5)), NOW)).toBe(0);
  });
});

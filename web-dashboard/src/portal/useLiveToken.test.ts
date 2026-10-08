import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalToken } from './portalApi';

// --- fakes ------------------------------------------------------------------
type Handler = (...args: unknown[]) => void;
const handlers = new Map<string, Handler[]>();
const managerHandlers = new Map<string, Handler[]>();
const fakeSocket = {
  connected: false,
  on(event: string, cb: Handler) {
    handlers.set(event, [...(handlers.get(event) ?? []), cb]);
    return fakeSocket;
  },
  emit: vi.fn(),
  connect() {
    fakeSocket.connected = true;
    handlers.get('connect')?.forEach((cb) => cb());
  },
  disconnect: vi.fn(() => {
    fakeSocket.connected = false;
  }),
  removeAllListeners() {
    handlers.clear();
  },
  io: {
    on(event: string, cb: Handler) {
      managerHandlers.set(event, [...(managerHandlers.get(event) ?? []), cb]);
    },
    off(event: string, cb: Handler) {
      managerHandlers.set(event, (managerHandlers.get(event) ?? []).filter((h) => h !== cb));
    },
  },
};
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));

const tokenRead = vi.fn<(id: string) => Promise<PortalToken>>();
vi.mock('./portalApi', () => ({ portalApi: { token: (id: string) => tokenRead(id) } }));

const { useLiveToken, RECONCILE_MS, RELOAD_DEBOUNCE_MS } = await import('./useLiveToken');

const WAITING: PortalToken = {
  id: 'tok-1',
  queueId: 'q1',
  serialNumber: 'A007',
  status: 'WAITING',
  position: 5,
  estimatedWaitMinutes: 25,
  etaUnavailableReason: null,
  counter: null,
  services: [{ id: 's1', serviceName: 'Enquiry' }],
  serviceStartVerificationRequired: false,
};

function fire(event: string, envelope: unknown) {
  handlers.get(event)?.forEach((cb) => cb(envelope));
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useLiveToken (ADR-075)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    managerHandlers.clear();
    fakeSocket.connected = false;
    tokenRead.mockReset();
    tokenRead.mockResolvedValue(WAITING);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function mounted() {
    const hook = renderHook(() => useLiveToken('tok-1'));
    await flush();
    const reads = tokenRead.mock.calls.length; // initial read + connect read
    return { hook, reads };
  }

  it('patches position and wait from token.position_changed without a read', async () => {
    const { hook, reads } = await mounted();
    act(() =>
      fire('token.position_changed', {
        tokenId: 'tok-1',
        data: { position: 2, estimatedWaitMinutes: 10, estimatedReadyAt: null, etaUnavailableReason: null },
      }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS * 4));
    expect(hook.result.current.token).toMatchObject({ status: 'WAITING', position: 2, estimatedWaitMinutes: 10 });
    expect(tokenRead).toHaveBeenCalledTimes(reads);
  });

  it('applies a lifecycle event’s full customer view as is, without a read', async () => {
    const { hook, reads } = await mounted();
    const called = { ...WAITING, status: 'CALLED' as const, position: null, counter: { id: 'c1', name: 'Desk 2' } };
    act(() => fire('token.called', { tokenId: 'tok-1', data: called }));
    await act(async () => vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS * 4));
    expect(hook.result.current.token).toEqual(called);
    expect(tokenRead).toHaveBeenCalledTimes(reads);
  });

  it.each(['token.completed', 'token.skipped', 'token.cancelled'])('%s reaches its final state from the event', async (event) => {
    const { hook } = await mounted();
    const status = { 'token.completed': 'COMPLETED', 'token.skipped': 'SKIPPED', 'token.cancelled': 'CANCELLED' }[event];
    act(() => fire(event, { tokenId: 'tok-1', data: { ...WAITING, status, position: null } }));
    expect(hook.result.current.token?.status).toBe(status);
  });

  it('a referral or next journey step (WAITING again, new step) is shown from the event', async () => {
    const { hook } = await mounted();
    const next = { ...WAITING, status: 'WAITING' as const, position: 1, journey: { steps: [], currentStepIndex: 1 } as never };
    act(() => fire('token.step_completed', { tokenId: 'tok-1', data: next }));
    expect(hook.result.current.token).toEqual(next);
  });

  it('a queue deletion’s cancellation carries the removal reason', async () => {
    const { hook } = await mounted();
    const removed = { ...WAITING, status: 'CANCELLED' as const, position: null, queueRemoved: { reason: 'Closed early' } };
    act(() => fire('token.cancelled', { tokenId: 'tok-1', data: removed }));
    expect(hook.result.current.token?.queueRemoved).toEqual({ reason: 'Closed early' });
  });

  it('a payload it cannot trust asks for one read, coalesced across a burst', async () => {
    const { reads } = await mounted();
    for (let i = 0; i < 20; i++) fire('token.called', { tokenId: 'tok-1', data: { partial: true } });
    await act(async () => vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS));
    expect(tokenRead).toHaveBeenCalledTimes(reads + 1);
  });

  it('a position update for a token not shown as waiting re-reads instead of patching', async () => {
    tokenRead.mockResolvedValue({ ...WAITING, status: 'CALLED', position: null });
    const { hook, reads } = await mounted();
    tokenRead.mockResolvedValue({ ...WAITING, position: 4 });
    act(() => fire('token.position_changed', { tokenId: 'tok-1', data: { position: 4, estimatedWaitMinutes: 20 } }));
    expect(hook.result.current.token?.status).toBe('CALLED');
    await act(async () => vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS));
    expect(tokenRead).toHaveBeenCalledTimes(reads + 1);
    expect(hook.result.current.token).toMatchObject({ status: 'WAITING', position: 4 });
  });

  it('an event outdates a read already in flight, so the older answer never overwrites it', async () => {
    const { hook } = await mounted();
    let answer!: (t: PortalToken) => void;
    tokenRead.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    void act(() => void hook.result.current.refresh());
    const called = { ...WAITING, status: 'CALLED' as const, position: null };
    act(() => fire('token.called', { tokenId: 'tok-1', data: called }));
    await act(async () => answer(WAITING));
    expect(hook.result.current.token?.status).toBe('CALLED');
  });

  it('ignores events addressed to another token', async () => {
    const { hook } = await mounted();
    act(() => fire('token.called', { tokenId: 'tok-2', data: { ...WAITING, id: 'tok-2', status: 'CALLED' } }));
    expect(hook.result.current.token?.status).toBe('WAITING');
  });

  it('every reconnect and every return to the page re-reads the token', async () => {
    const { reads } = await mounted();
    act(() => fire('disconnect', undefined));
    act(() => fakeSocket.connect());
    await flush();
    expect(tokenRead).toHaveBeenCalledTimes(reads + 1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await flush();
    expect(tokenRead).toHaveBeenCalledTimes(reads + 2);
  });

  it('a slow safety read reconciles a live visit, but not a finished one', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const { reads } = await mounted();
    await act(async () => vi.advanceTimersByTimeAsync(RECONCILE_MS * 1.2 + 1));
    expect(tokenRead).toHaveBeenCalledTimes(reads + 1);

    act(() => fire('token.completed', { tokenId: 'tok-1', data: { ...WAITING, status: 'COMPLETED', position: null } }));
    await act(async () => vi.advanceTimersByTimeAsync(RECONCILE_MS * 1.2 + 1));
    expect(tokenRead).toHaveBeenCalledTimes(reads + 1);
  });

  it('unmounting leaves no timers, listeners or reads behind', async () => {
    const { hook } = await mounted();
    fire('token.called', { tokenId: 'tok-1', data: { bad: true } }); // schedules a coalesced read
    const reads = tokenRead.mock.calls.length;
    hook.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(RECONCILE_MS * 2));
    expect(tokenRead).toHaveBeenCalledTimes(reads);
    expect(vi.getTimerCount()).toBe(0);
    expect(handlers.size).toBe(0);
    expect(managerHandlers.get('reconnect_failed')).toEqual([]);
    expect(fakeSocket.disconnect).toHaveBeenCalled();
  });

  it('registers each listener once', async () => {
    await mounted();
    for (const [event, list] of handlers) expect(list, event).toHaveLength(1);
  });
});

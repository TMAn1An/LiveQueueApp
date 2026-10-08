import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useOrganizationSocket } from './useOrganizationSocket';
import { getSocket, disconnectSocket } from '../services/socket.service';
import { MAX_WAIT_MS, QUIET_MS } from '../services/queryInvalidation';
import type { ApiResult } from '../api/client';
import type { LiveQueueTokenRow } from '../types/dashboard';

vi.mock('../services/socket.service');

type Handler = (...args: unknown[]) => void;

function createFakeSocket() {
  const handlers = new Map<string, Handler[]>();
  return {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== handler));
    }),
    emit: vi.fn(),
    connect: vi.fn(),
    trigger(event: string, ...args: unknown[]) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
  };
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useOrganizationSocket', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeSocket = createFakeSocket();
    vi.mocked(getSocket).mockReturnValue(fakeSocket as never);
    queryClient = new QueryClient();
    vi.spyOn(queryClient, 'invalidateQueries');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Lets the coalescing window close (ADR-074). */
  function endBurst() {
    vi.advanceTimersByTime(QUIET_MS);
  }

  function invalidatedKeys() {
    return vi.mocked(queryClient.invalidateQueries).mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
  }

  it('does nothing when organizationId is null (no connection attempted)', () => {
    renderHook(() => useOrganizationSocket(null), { wrapper: wrapper(queryClient) });
    expect(getSocket).not.toHaveBeenCalled();
  });

  it('connects and joins the organization room on connect', () => {
    renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    fakeSocket.trigger('connect');

    expect(fakeSocket.emit).toHaveBeenCalledWith(
      'join:organization',
      { organizationId: 'org-1' },
      expect.any(Function),
    );
  });

  it('re-joins the organization room on every reconnect, not just the first connect', () => {
    renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

    fakeSocket.trigger('connect');
    fakeSocket.trigger('connect'); // simulated reconnect after a network blip

    const joinCalls = fakeSocket.emit.mock.calls.filter((c) => c[0] === 'join:organization');
    expect(joinCalls).toHaveLength(2);
  });

  it('invalidates dashboard queries when a token.* event arrives', () => {
    renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

    fakeSocket.trigger('token.called', { type: 'token.called', organizationId: 'org-1', data: {} });
    endBurst();

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
  });

  it('invalidates the specific queue and queues list when a queue.* event arrives', () => {
    renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

    fakeSocket.trigger('queue.status_changed', {
      type: 'queue.status_changed',
      organizationId: 'org-1',
      queueId: 'q1',
      data: {},
    });
    endBurst();

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['queues'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['queue', 'q1'] });
  });

  it('invalidates counters for the affected queue when a counter.* event arrives', () => {
    renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

    fakeSocket.trigger('counter.status_changed', {
      type: 'counter.status_changed',
      organizationId: 'org-1',
      queueId: 'q1',
      data: {},
    });
    endBurst();

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['counters', 'q1'] });
  });

  describe('burst coalescing (ADR-074)', () => {
    function positionChanged(tokenId: string, position: number) {
      return {
        type: 'token.position_changed',
        organizationId: 'org-1',
        queueId: 'q1',
        tokenId,
        data: { position, estimatedWaitMinutes: position * 5, estimatedReadyAt: null, etaUnavailableReason: null },
      };
    }

    it('one Serve next with 500 people waiting refetches each view once, not once per person', () => {
      renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

      fakeSocket.trigger('token.called', { type: 'token.called', organizationId: 'org-1', queueId: 'q1', data: {} });
      for (let i = 1; i <= 500; i++) fakeSocket.trigger('token.position_changed', positionChanged(`t${i}`, i));
      expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

      endBurst();
      expect(invalidatedKeys().sort()).toEqual(['["dashboard"]', '["queue","q1"]', '["queues"]']);
    });

    it('still refreshes within MAX_WAIT_MS while events keep arriving', () => {
      renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

      for (let t = 0; t < MAX_WAIT_MS; t += QUIET_MS / 2) {
        fakeSocket.trigger('token.position_changed', positionChanged('t1', 1));
        vi.advanceTimersByTime(QUIET_MS / 2);
      }
      expect(invalidatedKeys()).toContain('["dashboard"]');
    });

    it('a burst after the previous one has flushed refetches again (nothing is lost)', () => {
      renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

      fakeSocket.trigger('token.created', { type: 'token.created', organizationId: 'org-1', queueId: 'q1', data: {} });
      endBurst();
      fakeSocket.trigger('token.completed', { type: 'token.completed', organizationId: 'org-1', queueId: 'q1', data: {} });
      endBurst();

      expect(invalidatedKeys().filter((k) => k === '["dashboard"]')).toHaveLength(2);
    });

    it('dashboard stats are covered by the dashboard prefix rather than fetched twice', () => {
      renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

      fakeSocket.trigger('queue.updated', { type: 'queue.updated', organizationId: 'org-1', queueId: 'q1', data: {} });
      fakeSocket.trigger('token.called', { type: 'token.called', organizationId: 'org-1', queueId: 'q1', data: {} });
      endBurst();

      expect(invalidatedKeys()).toContain('["dashboard"]');
      expect(invalidatedKeys()).not.toContain('["dashboard","stats"]');
    });

    it('patches the position and wait of a cached live-table row immediately', () => {
      const rows = [
        { id: 't1', position: 2, estimatedWaitMinutes: 10 },
        { id: 't2', position: 3, estimatedWaitMinutes: 15 },
      ] as LiveQueueTokenRow[];
      queryClient.setQueryData<ApiResult<LiveQueueTokenRow[]>>(['dashboard', 'tokens', 1, 20, 'q1'], { data: rows });
      renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

      fakeSocket.trigger('token.position_changed', positionChanged('t2', 1));

      const cached = queryClient.getQueryData<ApiResult<LiveQueueTokenRow[]>>(['dashboard', 'tokens', 1, 20, 'q1']);
      expect(cached?.data.find((row) => row.id === 't2')).toMatchObject({ position: 1, estimatedWaitMinutes: 5 });
      expect(cached?.data.find((row) => row.id === 't1')).toMatchObject({ position: 2, estimatedWaitMinutes: 10 });
    });

    it('re-syncs immediately on (re)connect, without waiting for a burst to end', () => {
      renderHook(() => useOrganizationSocket('org-1'), { wrapper: wrapper(queryClient) });

      fakeSocket.trigger('connect');

      expect(invalidatedKeys()).toEqual(expect.arrayContaining(['["queues"]', '["counters"]', '["dashboard"]']));
    });
  });

  it('disconnects the socket when organizationId becomes null (e.g. logout)', () => {
    const { rerender } = renderHook(({ orgId }) => useOrganizationSocket(orgId), {
      wrapper: wrapper(queryClient),
      initialProps: { orgId: 'org-1' as string | null },
    });

    rerender({ orgId: null });

    expect(disconnectSocket).toHaveBeenCalled();
  });
});

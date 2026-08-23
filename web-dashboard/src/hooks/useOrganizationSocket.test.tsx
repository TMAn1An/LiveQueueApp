import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useOrganizationSocket } from './useOrganizationSocket';
import { getSocket, disconnectSocket } from '../services/socket.service';

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
  });

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

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['counters', 'q1'] });
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

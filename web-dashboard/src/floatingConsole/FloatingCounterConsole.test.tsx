import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FloatingCounterConsole } from './FloatingCounterConsole';
import * as counterApi from '../api/counter.api';
import * as tokenApi from '../api/token.api';
import * as queueApi from '../api/queue.api';
import { ApiError } from '../api/client';
import type { CounterCurrentToken, MyCounter } from '../types/queue';

/**
 * ADR-072: the console is a view over the existing workflow. These tests mock
 * only the API modules, so the real mutation hooks run and what is asserted
 * is exactly which existing endpoint each control calls.
 */

const auth = vi.hoisted(() => ({ permissions: ['operate_tokens'] as string[] }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', hasPermission: (p: string) => auth.permissions.includes(p) }),
}));

const socket = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    connected: true,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => handlers.get(event)?.delete(fn)),
    connect: vi.fn(),
    fire(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args);
    },
    listenerCount: (event: string) => handlers.get(event)?.size ?? 0,
    reset() {
      handlers.clear();
      this.connected = true;
    },
  };
});
vi.mock('../services/socket.service', () => ({ getSocket: () => socket }));
vi.mock('../api/counter.api');
vi.mock('../api/token.api');
vi.mock('../api/queue.api');

const COUNTER: MyCounter = {
  id: 'c1',
  name: 'Counter 1',
  status: 'ACTIVE',
  queueId: 'q1',
  queueName: 'Pharmacy',
  currentToken: null,
};

function token(overrides: Partial<CounterCurrentToken> = {}): CounterCurrentToken {
  return {
    id: 't1',
    serialNumber: 'A007',
    status: 'CALLED',
    serviceName: 'Prescription pickup',
    calledAt: new Date(Date.now() - 65_000).toISOString(),
    startedAt: null,
    step: null,
    requiresVerificationCode: false,
    ...overrides,
  };
}

let mine: MyCounter | null = COUNTER;
let waiting = 4;

function setup(surface: 'pip' | 'dock' = 'dock') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FloatingCounterConsole surface={surface} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  /** What a socket event does in the app: mark the data stale; it refetches. */
  const serverChanged = () =>
    act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['counters', 'mine'] });
      await queryClient.invalidateQueries({ queryKey: ['queue', 'q1'] });
    });
  return { ...utils, queryClient, onClose, serverChanged };
}

const ok = <T,>(data: T) => Promise.resolve({ data });

beforeEach(() => {
  vi.clearAllMocks();
  socket.reset();
  auth.permissions = ['operate_tokens'];
  mine = { ...COUNTER };
  waiting = 4;
  localStorage.clear();
  vi.mocked(counterApi.getMyCounter).mockImplementation(() => ok(mine));
  vi.mocked(queueApi.getQueue).mockImplementation(() => ok({ id: 'q1', waitingCount: waiting } as never));
  vi.mocked(tokenApi.nextToken).mockImplementation(() => ok({ serialNumber: 'A008' } as never));
  vi.mocked(tokenApi.startToken).mockImplementation(() => ok({} as never));
  vi.mocked(tokenApi.completeToken).mockImplementation(() => ok({} as never));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Floating Counter Console — what it shows', () => {
  it('shows the counter, its state and the waiting count from the backend', async () => {
    setup();
    expect(await screen.findByText('Counter 1')).toBeInTheDocument();
    expect(await screen.findByText('4')).toBeInTheDocument();
    expect(screen.getByText('Nobody at your counter.')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows the person at the counter by token number and service only', async () => {
    mine = {
      ...COUNTER,
      currentToken: {
        ...token(),
        // Anything extra a backend might send is never rendered.
        ...({
          phone: '+1 555 0100',
          email: 'person@example.com',
          formFields: [{ label: 'Name', value: 'Jane Doe' }],
        } as object),
      } as CounterCurrentToken,
    };
    const { container } = setup();
    expect(await screen.findByTestId('console-token')).toHaveTextContent('A007');
    expect(screen.getByText('Prescription pickup')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/555|example\.com|Jane/);
  });

  it('a journey shows which step this is', async () => {
    mine = { ...COUNTER, currentToken: token({ step: { number: 2, total: 3 } }) };
    setup();
    expect(await screen.findByText(/step 2 of 3/)).toBeInTheDocument();
  });
});

describe('Floating Counter Console — actions use the existing endpoints', () => {
  it('Serve next calls POST /api/queues/:id/next once, even when clicked twice', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(tokenApi.nextToken).mockImplementation(() => new Promise((r) => (resolve = r)) as never);
    setup();
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Serve next' });
    await user.click(button);
    await user.click(screen.getByRole('button', { name: /Calling/ }));
    expect(tokenApi.nextToken).toHaveBeenCalledTimes(1);
    expect(tokenApi.nextToken).toHaveBeenCalledWith('q1');
    await act(async () => resolve({ data: {} }));
  });

  it('nothing advances on screen until the backend has answered', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Serve next' }));
    // The mutation succeeded, but the console still shows the backend's last
    // answer until its own refetch brings the new state.
    expect(screen.queryByTestId('console-token')).not.toBeInTheDocument();
    mine = { ...COUNTER, currentToken: token({ serialNumber: 'A008' }) };
    await waitFor(() => expect(counterApi.getMyCounter).toHaveBeenCalledTimes(2));
  });

  it('a paused counter cannot serve', async () => {
    mine = { ...COUNTER, status: 'ON_BREAK' };
    setup();
    expect(await screen.findByRole('button', { name: 'Serve next' })).toBeDisabled();
    expect(screen.getByText(/counter is paused/)).toBeInTheDocument();
  });

  it('CALLED: Start calls POST /api/tokens/:id/start (no code on a queue without one)', async () => {
    mine = { ...COUNTER, currentToken: token() };
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    expect(tokenApi.startToken).toHaveBeenCalledWith('t1', undefined);
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
  });

  it('CALLED with a verification code: Start asks for it, then sends it', async () => {
    mine = { ...COUNTER, currentToken: token({ requiresVerificationCode: true }) };
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    expect(tokenApi.startToken).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Verification code'), '482913');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(tokenApi.startToken).toHaveBeenCalledWith('t1', '482913');
  });

  it('IN_PROGRESS: Complete calls POST /api/tokens/:id/complete, once', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(tokenApi.completeToken).mockImplementation(() => new Promise((r) => (resolve = r)) as never);
    mine = { ...COUNTER, currentToken: token({ status: 'IN_PROGRESS', startedAt: new Date().toISOString() }) };
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Complete' }));
    await user.click(screen.getByRole('button', { name: /Completing/ }));
    expect(tokenApi.completeToken).toHaveBeenCalledTimes(1);
    expect(tokenApi.completeToken).toHaveBeenCalledWith('t1', undefined, undefined);
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    await act(async () => resolve({ data: {} }));
  });

  it('a journey step that is not the last says "Complete step"', async () => {
    mine = { ...COUNTER, currentToken: token({ status: 'IN_PROGRESS', step: { number: 1, total: 2 } }) };
    setup();
    expect(await screen.findByRole('button', { name: 'Complete step' })).toBeInTheDocument();
  });

  it('when another device acted first, it says so and re-reads the counter', async () => {
    vi.mocked(tokenApi.nextToken).mockRejectedValue(
      new ApiError(409, 'TOKEN_STATE_CHANGED', 'That person was already called.'),
    );
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Serve next' }));
    expect(await screen.findByText('That person was already called.')).toBeInTheDocument();
    await waitFor(() => expect(counterApi.getMyCounter).toHaveBeenCalledTimes(2));
  });
});

describe('Floating Counter Console — compact and expanded', () => {
  it('compact shows only the main action; expanded adds Skip and Feedback, and is remembered', async () => {
    mine = { ...COUNTER, currentToken: token({ status: 'IN_PROGRESS' }) };
    const { unmount } = setup();
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Complete' });
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Feedback' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refer' })).not.toBeInTheDocument();
    expect(localStorage.getItem('livequeue.floatingConsole.mode')).toBe('expanded');

    unmount();
    setup();
    expect(await screen.findByRole('button', { name: 'Skip' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compact' }));
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  it('expanded: a step with another to follow offers Refer instead of Feedback', async () => {
    localStorage.setItem('livequeue.floatingConsole.mode', 'expanded');
    mine = { ...COUNTER, currentToken: token({ status: 'IN_PROGRESS', step: { number: 1, total: 2 } }) };
    setup();
    expect(await screen.findByRole('button', { name: 'Refer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Feedback' })).not.toBeInTheDocument();
  });

  it('expanded: Skip and Feedback open the existing dialogs', async () => {
    localStorage.setItem('livequeue.floatingConsole.mode', 'expanded');
    mine = { ...COUNTER, currentToken: token({ status: 'IN_PROGRESS' }) };
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Feedback' }));
    expect(screen.getByRole('dialog', { name: 'Complete with feedback' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Floating Counter Console — realtime', () => {
  it('follows the backend when the person at the counter changes elsewhere', async () => {
    const { serverChanged } = setup();
    await screen.findByText('Nobody at your counter.');
    mine = { ...COUNTER, currentToken: token({ serialNumber: 'B012' }) };
    await serverChanged();
    expect(await screen.findByTestId('console-token')).toHaveTextContent('B012');

    mine = { ...COUNTER, currentToken: token({ serialNumber: 'B012', status: 'IN_PROGRESS' }) };
    await serverChanged();
    expect(await screen.findByRole('button', { name: 'Complete' })).toBeInTheDocument();

    mine = { ...COUNTER, currentToken: null };
    await serverChanged();
    expect(await screen.findByText('Nobody at your counter.')).toBeInTheDocument();
  });

  it('updates the waiting count and the counter state', async () => {
    const { serverChanged } = setup();
    await screen.findByText('4');
    waiting = 9;
    mine = { ...COUNTER, status: 'ON_BREAK' };
    await serverChanged();
    expect(await screen.findByText('9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Serve next' })).toBeDisabled();
  });

  it('holds actions while the connection is reconnecting', async () => {
    setup();
    const serve = await screen.findByRole('button', { name: 'Serve next' });
    act(() => socket.fire('disconnect', 'transport close'));
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    expect(serve).toBeDisabled();
    act(() => socket.fire('connect'));
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(serve).toBeEnabled();
  });

  it('when the server drops the connection, it re-checks access before reconnecting', async () => {
    setup();
    await screen.findByRole('button', { name: 'Serve next' });
    socket.connected = false;
    act(() => socket.fire('disconnect', 'io server disconnect'));
    expect(screen.getByText('Checking access…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Serve next' })).toBeDisabled();
    await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    expect(counterApi.getMyCounter).toHaveBeenCalledTimes(2);
  });

  it('a revoked session never reconnects the socket (the 401 signs the dashboard out)', async () => {
    setup();
    await screen.findByRole('button', { name: 'Serve next' });
    vi.mocked(counterApi.getMyCounter).mockRejectedValue(new ApiError(401, 'SESSION_REVOKED', 'Please sign in again.'));
    socket.connected = false;
    act(() => socket.fire('disconnect', 'io server disconnect'));
    await waitFor(() => expect(counterApi.getMyCounter).toHaveBeenCalledTimes(2));
    expect(socket.connect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Serve next' })).toBeDisabled();
  });
});

describe('Floating Counter Console — authorization', () => {
  it('without the operate permission it shows access lost and no actions', async () => {
    auth.permissions = [];
    setup();
    expect(await screen.findByText('Access changed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Serve next' })).not.toBeInTheDocument();
    expect(counterApi.getMyCounter).toHaveBeenCalled(); // reads, never acts
  });

  it('when the counter assignment is taken away, the actions go with it', async () => {
    mine = { ...COUNTER, currentToken: token() };
    const { serverChanged } = setup();
    await screen.findByRole('button', { name: 'Start' });
    mine = null;
    await serverChanged();
    expect(await screen.findByText('No counter assigned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('close calls back to the host', async () => {
    const { onClose } = setup('pip');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Close floating console' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('removes its socket listeners when it goes away', async () => {
    const { unmount } = setup();
    await screen.findByText('Counter 1');
    expect(socket.listenerCount('disconnect')).toBe(1);
    unmount();
    expect(socket.listenerCount('disconnect')).toBe(0);
    expect(socket.listenerCount('connect')).toBe(0);
  });
});

describe('Floating Counter Console — timer', () => {
  it('derives elapsed time from the backend timestamp, not from when it opened', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calledAt = new Date(Date.now() - 125_000).toISOString();
    mine = { ...COUNTER, currentToken: token({ calledAt }) };
    setup();
    expect(await screen.findByTestId('console-timer')).toHaveTextContent('2:05');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId('console-timer')).toHaveTextContent('2:08');
  });

  it('IN_PROGRESS counts from when service started', async () => {
    mine = {
      ...COUNTER,
      currentToken: token({
        status: 'IN_PROGRESS',
        calledAt: new Date(Date.now() - 600_000).toISOString(),
        startedAt: new Date(Date.now() - 30_000).toISOString(),
      }),
    };
    setup();
    expect(await screen.findByTestId('console-timer')).toHaveTextContent(/^Serving for 0:3\d$/);
  });
});

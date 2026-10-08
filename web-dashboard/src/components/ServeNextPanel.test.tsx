import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServeNextPanel } from './ServeNextPanel';
import { useMyCounter } from '../hooks/useCounters';
import { useNextToken } from '../hooks/useTokenActions';
import { ApiError } from '../api/client';
import type { MyCounter } from '../types/queue';
import { FloatingConsoleProvider } from '../floatingConsole/FloatingConsoleContext';

// ADR-064: every role holds operate_tokens; only OWNER/ADMIN hold manage_staff.
let isStaff = true;
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => (permission === 'manage_staff' ? !isStaff : true),
  }),
}));
vi.mock('../hooks/useCounters');
vi.mock('../hooks/useTokenActions');

const nextMutate = vi.fn();

function mine(counter: MyCounter | null) {
  vi.mocked(useMyCounter).mockReturnValue({ data: counter, isLoading: false } as unknown as ReturnType<
    typeof useMyCounter
  >);
}

const own: MyCounter = { id: 'c1', name: 'Counter A', status: 'ACTIVE', queueId: 'q1', queueName: 'Pharmacy' };

function renderPanel(queueId = 'q1') {
  return render(
    <MemoryRouter>
      <ServeNextPanel queueId={queueId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isStaff = true;
  vi.mocked(useNextToken).mockReturnValue({ mutate: nextMutate, isPending: false } as unknown as ReturnType<
    typeof useNextToken
  >);
});

describe('ServeNextPanel — serving is a self-claim at your own counter (ADR-064)', () => {
  it('shows the assigned counter and a Serve next action, with no selector of any kind', () => {
    mine(own);
    renderPanel();

    expect(screen.getByText('Counter A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Serve next' })).toBeEnabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign|change counter|switch/i })).not.toBeInTheDocument();
  });

  it('Serve next sends only the queue — never a counter, staff member or person', async () => {
    mine(own);
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Serve next' }));

    expect(nextMutate).toHaveBeenCalledWith('q1', expect.anything());
  });

  it('confirms who was called', async () => {
    mine(own);
    nextMutate.mockImplementationOnce((_q, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ data: { serialNumber: 'A001' } }),
    );
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Serve next' }));

    expect(screen.getByRole('status')).toHaveTextContent('Called A001 to Counter A.');
  });

  it('shows the backend’s refusal as-is', async () => {
    mine(own);
    nextMutate.mockImplementationOnce((_q, options: { onError: (e: unknown) => void }) =>
      options.onError(new ApiError(404, 'NO_ELIGIBLE_TOKENS', 'No eligible waiting tokens.')),
    );
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Serve next' }));

    expect(screen.getByRole('alert')).toHaveTextContent('No eligible waiting tokens.');
  });

  it('cannot serve from a counter that is not open', () => {
    mine({ ...own, status: 'ON_BREAK' });
    renderPanel();

    expect(screen.getByRole('button', { name: 'Serve next' })).toBeDisabled();
    expect(screen.getByText(/Ask the organization owner or an admin to open it/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Counters' })).not.toBeInTheDocument();
  });

  it('an unassigned person is told who assigns counters, and gets no action', () => {
    mine(null);
    renderPanel();

    expect(screen.getByText('You are not assigned to a counter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Serve next' })).not.toBeInTheDocument();
  });

  it('a counter in another queue cannot serve this one', () => {
    mine({ ...own, queueId: 'q2', queueName: 'Registration' });
    renderPanel('q1');

    expect(screen.getByText('Your counter, Counter A, serves Registration')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Serve next' })).not.toBeInTheDocument();
  });

  it('an assigned owner or admin gets Serve next like anyone else', () => {
    isStaff = false;
    mine(own);
    renderPanel();
    expect(screen.getByRole('button', { name: 'Serve next' })).toBeEnabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('an unassigned owner or admin is pointed at Counters to assign themselves', () => {
    isStaff = false;
    mine(null);
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Serve next' })).not.toBeInTheDocument();
    expect(screen.getByText('You are not assigned to a counter')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Counters' })).toHaveAttribute('href', '/queues/q1/counters');
  });
});

describe('ServeNextPanel — Floating Counter Console entry (ADR-072)', () => {
  function renderWithConsole(queueId = 'q1') {
    return render(
      <MemoryRouter>
        <FloatingConsoleProvider>
          <ServeNextPanel queueId={queueId} />
        </FloatingConsoleProvider>
      </MemoryRouter>,
    );
  }

  it('offers the floating console to the operator of a counter in this queue', () => {
    mine(own);
    renderWithConsole();
    expect(screen.getByRole('button', { name: 'Open floating console' })).toBeInTheDocument();
    // Serving from the page is unchanged.
    expect(screen.getByRole('button', { name: 'Serve next' })).toBeEnabled();
  });

  it('is not offered to someone without a counter here', () => {
    mine(null);
    renderWithConsole();
    expect(screen.queryByRole('button', { name: 'Open floating console' })).not.toBeInTheDocument();
    mine({ ...own, queueId: 'q2', queueName: 'Other' });
    renderWithConsole();
    expect(screen.queryByRole('button', { name: 'Open floating console' })).not.toBeInTheDocument();
  });

  it('is not offered outside the signed-in layout', () => {
    mine(own);
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Open floating console' })).not.toBeInTheDocument();
  });
});

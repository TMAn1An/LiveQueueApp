import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ServeNextPanel } from './ServeNextPanel';
import { useMyCounter } from '../hooks/useCounters';
import { useNextToken } from '../hooks/useTokenActions';
import { ApiError } from '../api/client';
import type { MyCounter } from '../types/queue';

// ADR-064: STAFF hold operate_tokens; OWNER/ADMIN hold manage_staff instead.
let isStaff = true;
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      permission === 'operate_tokens' ? isStaff : permission === 'manage_staff' ? !isStaff : true,
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

  it('owner/admin get no Serve next — they manage assignments, staff serve', () => {
    isStaff = false;
    mine(null);
    renderPanel();

    expect(screen.queryByRole('button', { name: 'Serve next' })).not.toBeInTheDocument();
    expect(screen.getByText('Staff serve people from their own counters')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Counters' })).toHaveAttribute('href', '/queues/q1/counters');
  });
});

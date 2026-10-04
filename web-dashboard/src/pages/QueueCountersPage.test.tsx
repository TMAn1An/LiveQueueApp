import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueueCountersPage } from './QueueCountersPage';
import { useQueue } from '../hooks/useQueues';
import {
  useAssignCounter,
  useAssignableStaff,
  useCounters,
  useCreateCounter,
  useDeleteCounter,
  useSetCounterServices,
  useSetCounterStatus,
  useUpdateCounter,
} from '../hooks/useCounters';
import { ApiError } from '../api/client';

/**
 * ADR-069: an open or paused counter always has an operator; Turn Off is
 * what releases one. ADR-070: a counter handles every service unless limited.
 */
let grantedPermissions: string[] = [];
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => grantedPermissions.includes(p),
    staff: { id: 'me' },
  }),
}));
vi.mock('../hooks/useQueues');
vi.mock('../hooks/useCounters');

const assignMutate = vi.fn();
const createMutate = vi.fn();
const statusMutate = vi.fn();
const servicesMutate = vi.fn();
const deleteMutate = vi.fn();

function counter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    queueId: 'q1',
    name: 'Counter 1',
    status: 'ACTIVE',
    staffId: 'jane',
    operator: { id: 'jane', name: 'Jane', role: 'STAFF' },
    serviceIds: [],
    ...overrides,
  };
}

function setCounters(list: unknown[]) {
  vi.mocked(useCounters).mockReturnValue({ data: list, isLoading: false } as unknown as ReturnType<
    typeof useCounters
  >);
}

function setQueue(canManage = true) {
  vi.mocked(useQueue).mockReturnValue({
    data: {
      id: 'q1',
      name: 'Front Desk',
      canManage,
      services: [
        { id: 'reg', serviceName: 'Registration', isActive: true },
        { id: 'pay', serviceName: 'Payment', isActive: true },
      ],
    },
  } as unknown as ReturnType<typeof useQueue>);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/queues/q1/counters']}>
      <Routes>
        <Route path="/queues/:queueId/counters" element={<QueueCountersPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  grantedPermissions = ['manage_counters', 'manage_staff'];
  vi.clearAllMocks();
  setQueue();
  setCounters([counter()]);
  vi.mocked(useAssignableStaff).mockReturnValue({
    data: [
      { id: 'jane', name: 'Jane', role: 'STAFF', currentCounter: { id: 'c1', name: 'Counter 1', queueName: 'Front Desk' } },
      { id: 'kofi', name: 'Kofi', role: 'STAFF', currentCounter: null },
      { id: 'bilal', name: 'Bilal', role: 'STAFF', currentCounter: { id: 'c2', name: 'Counter 2', queueName: 'Front Desk' } },
    ],
    isLoading: false,
  } as unknown as ReturnType<typeof useAssignableStaff>);
  vi.mocked(useAssignCounter).mockReturnValue({ mutate: assignMutate } as unknown as ReturnType<typeof useAssignCounter>);
  vi.mocked(useUpdateCounter).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useUpdateCounter>);
  vi.mocked(useSetCounterStatus).mockReturnValue({ mutate: statusMutate } as unknown as ReturnType<
    typeof useSetCounterStatus
  >);
  vi.mocked(useSetCounterServices).mockReturnValue({ mutate: servicesMutate } as unknown as ReturnType<
    typeof useSetCounterServices
  >);
  vi.mocked(useDeleteCounter).mockReturnValue({ mutate: deleteMutate } as unknown as ReturnType<typeof useDeleteCounter>);
  vi.mocked(useCreateCounter).mockReturnValue({ mutate: createMutate, isPending: false } as unknown as ReturnType<
    typeof useCreateCounter
  >);
});

describe('QueueCountersPage — counter lifecycle (ADR-069)', () => {
  it('pauses an open counter, keeping its operator', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(statusMutate).toHaveBeenCalledWith(
      { counterId: 'c1', status: 'ON_BREAK', operatorStaffId: undefined },
      expect.anything(),
    );
  });

  it('turns a counter off only after confirming that its operator is released', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Turn Off' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Jane is released');
    expect(statusMutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Turn Off' }));
    expect(statusMutate).toHaveBeenCalledWith(
      { counterId: 'c1', status: 'OFFLINE', operatorStaffId: undefined },
      expect.anything(),
    );
  });

  it('assigning an operator to an OFF counter makes it PAUSED — never ACTIVE — and says so', async () => {
    const user = userEvent.setup();
    setCounters([counter({ status: 'OFFLINE', staffId: null, operator: null })]);
    renderPage();
    expect(screen.getByText(/Off → operator assigned →/)).toHaveTextContent('Paused');
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    const assign = screen.getByRole('button', { name: 'Assign' });
    expect(assign).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Operator for Counter 1'), 'kofi');
    await user.click(assign);
    expect(statusMutate).toHaveBeenCalledWith(
      { counterId: 'c1', status: 'ON_BREAK', operatorStaffId: 'kofi' },
      expect.anything(),
    );
    expect(statusMutate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }), expect.anything());
  });

  it('a paused counter opens only through the explicit Resume action', async () => {
    const user = userEvent.setup();
    setCounters([counter({ status: 'ON_BREAK' })]);
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(statusMutate).toHaveBeenCalledWith(
      { counterId: 'c1', status: 'ACTIVE', operatorStaffId: undefined },
      expect.anything(),
    );
  });

  it('moving someone onto an OFF counter warns that it becomes Paused', async () => {
    const user = userEvent.setup();
    setCounters([counter({ status: 'OFFLINE', staffId: null, operator: null })]);
    renderPage();
    await user.selectOptions(screen.getByLabelText('Operator for Counter 1'), 'bilal');
    await user.click(screen.getByRole('button', { name: 'Move here' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Counter 1 becomes Paused');
  });

  it('never offers to empty an open counter — only to replace its operator', () => {
    renderPage();
    const picker = screen.getByLabelText('Change the operator of Counter 1');
    const options = within(picker).getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('Unassigned');
    expect(options.some((o) => o?.startsWith('Jane'))).toBe(false);
  });

  it('replaces the operator directly, and asks before moving someone from another counter', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText('Change the operator of Counter 1'), 'kofi');
    expect(assignMutate).toHaveBeenCalledWith({ counterId: 'c1', staffId: 'kofi' }, expect.anything());

    await user.selectOptions(screen.getByLabelText('Change the operator of Counter 1'), 'bilal');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Counter 2, which turns off');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(assignMutate).toHaveBeenLastCalledWith(
      { counterId: 'c1', staffId: 'bilal', move: true },
      expect.anything(),
    );
  });

  it('shows the backend message when a change is refused', async () => {
    const user = userEvent.setup();
    statusMutate.mockImplementation((_v, { onError }: { onError: (e: unknown) => void }) =>
      onError(new ApiError(409, 'COUNTER_HAS_ACTIVE_SERVICE', 'Finish the visit in progress first.')),
    );
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Finish the visit in progress first.');
  });
});

describe('QueueCountersPage — services per counter (ADR-070)', () => {
  it('says a counter with no limit handles every service', () => {
    renderPage();
    expect(screen.getByText('Every service')).toBeInTheDocument();
  });

  it('limits a counter to chosen services, or back to every service', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Services' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText('Every service (default)'));
    await user.click(within(dialog).getByLabelText('Payment'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(servicesMutate).toHaveBeenCalledWith({ counterId: 'c1', serviceIds: ['pay'] }, expect.anything());
  });

  it('lists the services a limited counter handles', () => {
    setCounters([counter({ serviceIds: ['reg'] })]);
    renderPage();
    expect(screen.getByText('Registration')).toBeInTheDocument();
  });
});

describe('QueueCountersPage — who may manage', () => {
  it('gives an Organization Manager (or anyone the server says cannot manage) a read-only list', () => {
    setQueue(false);
    renderPage();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    for (const name of ['Pause', 'Turn Off', 'Services', 'Delete', 'Add Counter']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('gives an Executive (no manage_counters) a read-only list with their own counter marked', () => {
    grantedPermissions = ['operate_tokens'];
    setCounters([counter({ staffId: 'me', operator: { id: 'me', name: 'Me', role: 'STAFF' } })]);
    renderPage();
    expect(screen.getByText('Your counter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  it('deletes only after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteMutate).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(deleteMutate).toHaveBeenCalledWith('c1', expect.anything());
  });

  it('shows a fallback message when creating a counter fails without a server answer', async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_name, { onError }: { onError: (e: unknown) => void }) => onError(new Error('down')));
    renderPage();
    await user.type(screen.getByLabelText('New counter name'), 'Counter 2');
    await user.click(screen.getByRole('button', { name: 'Add Counter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create counter.');
  });
});

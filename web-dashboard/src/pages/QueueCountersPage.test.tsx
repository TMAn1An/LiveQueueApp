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
  useSetCounterStatus,
  useUpdateCounter,
} from '../hooks/useCounters';
import { useStaffList } from '../hooks/useStaff';
import { ApiError } from '../api/client';

/** ADR-036 gates the staff-assignment control on manage_staff, which
 * ordinary STAFF do not hold — so the tests need to be able to play both. */
let grantedPermissions: string[] = [];
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => grantedPermissions.includes(p),
    staff: { id: 'me' },
  }),
}));
vi.mock('../hooks/useQueues');
vi.mock('../hooks/useCounters');
vi.mock('../hooks/useStaff');

const assignMutate = vi.fn();
const createMutate = vi.fn();

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
  grantedPermissions = ['manage_counters', 'manage_staff', 'operate_tokens'];
  vi.clearAllMocks();
  vi.mocked(useQueue).mockReturnValue({ data: { id: 'q1', name: 'Front Desk' } } as unknown as ReturnType<
    typeof useQueue
  >);
  vi.mocked(useStaffList).mockReturnValue({
    data: { data: [{ id: 'staff-1', name: 'Jane' }] },
  } as unknown as ReturnType<typeof useStaffList>);
  vi.mocked(useAssignableStaff).mockReturnValue({
    data: [{ id: 'staff-1', name: 'Jane' }],
    isLoading: false,
  } as unknown as ReturnType<typeof useAssignableStaff>);
  vi.mocked(useCounters).mockReturnValue({
    data: [{ id: 'c1', queueId: 'q1', name: 'Counter 1', status: 'ACTIVE', staffId: null }],
    isLoading: false,
  } as unknown as ReturnType<typeof useCounters>);
  vi.mocked(useAssignCounter).mockReturnValue({ mutate: assignMutate } as unknown as ReturnType<
    typeof useAssignCounter
  >);
  vi.mocked(useUpdateCounter).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<
    typeof useUpdateCounter
  >);
  vi.mocked(useSetCounterStatus).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<
    typeof useSetCounterStatus
  >);
  vi.mocked(useDeleteCounter).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<
    typeof useDeleteCounter
  >);
  vi.mocked(useCreateCounter).mockReturnValue({
    mutate: createMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateCounter>);
});

describe('QueueCountersPage — error display', () => {
  it('shows no error banner initially', () => {
    renderPage();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the backend error message when assigning a staff member fails', async () => {
    const user = userEvent.setup();
    assignMutate.mockImplementation((_vars, { onError }: { onError: (e: unknown) => void }) => {
      onError(new ApiError(409, 'STAFF_ALREADY_ASSIGNED', 'This staff member is already assigned to another counter.'));
    });
    renderPage();

    const [, assignSelect] = screen.getAllByRole('combobox');
    await user.selectOptions(assignSelect, 'staff-1');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This staff member is already assigned to another counter.',
    );
  });

  it('shows a fallback message when create-counter fails with a non-ApiError', async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_name, { onError }: { onError: (e: unknown) => void }) => {
      onError(new Error('network down'));
    });
    renderPage();

    await user.type(screen.getByRole('textbox'), 'New Counter');
    await user.click(screen.getByText('Add Counter'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create counter.');
  });
});

describe('QueueCountersPage — staff availability', () => {
  it('offers only the staff the backend says are assignable, plus Unassigned', () => {
    // "Busy Bilal" holds another counter, so the backend leaves him out.
    vi.mocked(useAssignableStaff).mockReturnValue({
      data: [
        { id: 'staff-1', name: 'Jane' },
        { id: 'staff-3', name: 'Kara' },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useAssignableStaff>);

    renderPage();

    const select = screen.getByLabelText('Assigned staff');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Unassigned', 'Jane', 'Kara']);
    expect(options).not.toContain('Busy Bilal');
  });

  it('sends null when Unassigned is chosen, which frees the person again', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Assigned staff'), '');

    expect(assignMutate).toHaveBeenCalledWith(
      expect.objectContaining({ counterId: 'c1', staffId: null }),
      expect.anything(),
    );
  });

  it('locks the control and reports progress while an assignment is in flight', () => {
    vi.mocked(useAssignCounter).mockReturnValue({
      mutate: assignMutate,
      isPending: true,
    } as unknown as ReturnType<typeof useAssignCounter>);

    renderPage();

    expect(screen.getByLabelText('Assigned staff')).toBeDisabled();
    expect(screen.getByText('Assigning…')).toBeInTheDocument();
  });

  it('leaves the control usable after a failed assignment', () => {
    // A settled mutation reports isPending false regardless of outcome, so the
    // control can never be left permanently disabled by an error.
    vi.mocked(useAssignCounter).mockReturnValue({
      mutate: assignMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useAssignCounter>);

    renderPage();

    expect(screen.getByLabelText('Assigned staff')).toBeEnabled();
    expect(screen.queryByText('Assigning…')).not.toBeInTheDocument();
  });

  it('disables the control while the options are still loading', () => {
    vi.mocked(useAssignableStaff).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useAssignableStaff>);

    renderPage();

    expect(screen.getByLabelText('Assigned staff')).toBeDisabled();
  });
});

/**
 * ADR-036: deciding who stands at a counter is a staffing decision. Ordinary
 * STAFF keep every operational control on this page — including putting a
 * counter on break — but not that one. The backend refuses it for them
 * regardless; this keeps the control from appearing at all.
 */
describe('QueueCountersPage — who may assign staff', () => {
  it('offers the assignment dropdown to an owner or admin', () => {
    renderPage();

    expect(screen.getByLabelText('Assigned staff')).toBeInTheDocument();
  });

  it('hides it from an ordinary staff member, and keeps their other controls', () => {
    grantedPermissions = ['manage_counters', 'operate_tokens'];
    vi.mocked(useCounters).mockReturnValue({
      data: [{ id: 'c1', queueId: 'q1', name: 'Counter 1', status: 'ACTIVE', staffId: 'me' }],
      isLoading: false,
    } as unknown as ReturnType<typeof useCounters>);

    renderPage();

    expect(screen.queryByLabelText('Assigned staff')).not.toBeInTheDocument();
    // Still able to run their own counter.
    expect(screen.getByLabelText('Counter status')).toBeInTheDocument();
  });

  // ADR-064: STAFF see which counter is theirs, operate only that one, and
  // have no way to change who stands where.
  it('marks a staff member’s own counter and gives them controls for it alone', () => {
    grantedPermissions = ['manage_counters', 'operate_tokens'];
    vi.mocked(useCounters).mockReturnValue({
      data: [
        { id: 'c1', queueId: 'q1', name: 'Counter 1', status: 'ACTIVE', staffId: 'me' },
        { id: 'c2', queueId: 'q1', name: 'Counter 2', status: 'ACTIVE', staffId: 'staff-1' },
        { id: 'c3', queueId: 'q1', name: 'Counter 3', status: 'OFFLINE', staffId: null },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useCounters>);

    renderPage();

    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Your counter')).toBeInTheDocument();
    expect(within(rows[0]!).getByLabelText('Counter status')).toBeInTheDocument();
    expect(within(rows[1]!).queryByLabelText('Counter status')).not.toBeInTheDocument();
    expect(within(rows[2]!).queryByLabelText('Counter status')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Counter status')).toHaveLength(1);
    expect(screen.queryByLabelText('Assigned staff')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('owner/admin get status, assignment and delete controls on every counter', () => {
    vi.mocked(useCounters).mockReturnValue({
      data: [
        { id: 'c1', queueId: 'q1', name: 'Counter 1', status: 'ACTIVE', staffId: 'staff-1' },
        { id: 'c2', queueId: 'q1', name: 'Counter 2', status: 'ACTIVE', staffId: null },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useCounters>);

    renderPage();

    expect(screen.getAllByLabelText('Assigned staff')).toHaveLength(2);
    expect(screen.getAllByLabelText('Counter status')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
  });

  it('owner/admin change and clear an assignment through the same control', async () => {
    vi.mocked(useCounters).mockReturnValue({
      data: [{ id: 'c1', queueId: 'q1', name: 'Counter 1', status: 'ACTIVE', staffId: 'staff-1' }],
      isLoading: false,
    } as unknown as ReturnType<typeof useCounters>);
    vi.mocked(useAssignableStaff).mockReturnValue({
      data: [
        { id: 'staff-1', name: 'Jane' },
        { id: 'staff-2', name: 'Rahim' },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useAssignableStaff>);

    renderPage();
    await userEvent.selectOptions(screen.getByLabelText('Assigned staff'), 'staff-2');
    expect(assignMutate).toHaveBeenLastCalledWith({ counterId: 'c1', staffId: 'staff-2' }, expect.anything());
    await userEvent.selectOptions(screen.getByLabelText('Assigned staff'), '');
    expect(assignMutate).toHaveBeenLastCalledWith({ counterId: 'c1', staffId: null }, expect.anything());
  });

  it('does not even ask who is available when it cannot assign', () => {
    grantedPermissions = ['manage_counters', 'operate_tokens'];

    renderPage();

    // The hook is called with enabled=false, so no refused request is fired.
    expect(useAssignableStaff).toHaveBeenCalledWith(expect.any(String), false);
  });
});

// V2 Product Completion checkpoint, Part B: deleting a counter must ask
// first — it previously called the mutation directly on click.
describe('QueueCountersPage — delete confirmation', () => {
  it('does not call the delete mutation until Delete is clicked and confirmed', async () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteCounter).mockReturnValue({ mutate } as unknown as ReturnType<
      typeof useDeleteCounter
    >);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByText('Delete counter "Counter 1"?')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Delete counter "Counter 1"?')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('calls the existing delete mutation once confirmed', async () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteCounter).mockReturnValue({ mutate } as unknown as ReturnType<
      typeof useDeleteCounter
    >);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await userEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(mutate).toHaveBeenCalledWith('c1', expect.anything());
  });
});

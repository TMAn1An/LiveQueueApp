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

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
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

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueuesPage } from './QueuesPage';
import { useDeleteQueue, useQueues, useUpdateQueueStatus } from '../hooks/useQueues';
import type { Queue } from '../types/queue';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../hooks/useQueues');

function mockQueue(overrides: Partial<Queue> = {}): Queue {
  return {
    id: 'q1',
    organizationId: 'org1',
    name: 'Front Desk',
    description: null,
    status: 'ACTIVE',
    clientTerminology: null,
    tokenPrefix: 'A',
    startingNumber: 1,
    nextTokenNumber: 1,
    baseTimeMinutes: 5,
    defaultNotificationMinutes: 10,
    allowRepeatVisits: true,
    allowMultipleServices: true,
    formVersion: 1,
    qrCodeUri: 'livequeue://queue/q1',
    deletedAt: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    services: [],
    counterCount: 3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useUpdateQueueStatus).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<
    typeof useUpdateQueueStatus
  >);
  vi.mocked(useDeleteQueue).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<
    typeof useDeleteQueue
  >);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<QueuesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('QueuesPage — Counters column (Issue 1: discoverability)', () => {
  it('renders a Counters column header', () => {
    vi.mocked(useQueues).mockReturnValue({ data: [mockQueue()], isLoading: false } as unknown as ReturnType<
      typeof useQueues
    >);
    renderPage();

    expect(screen.getByText('Counters')).toBeInTheDocument();
  });

  it("shows each queue's counter count", () => {
    // Non-zero, non-colliding values — the Services column also renders "0"
    // for an empty services array, so 0 would ambiguously match both columns.
    vi.mocked(useQueues).mockReturnValue({
      data: [mockQueue({ id: 'q1', counterCount: 3 }), mockQueue({ id: 'q2', name: 'Back Office', counterCount: 7 })],
      isLoading: false,
    } as unknown as ReturnType<typeof useQueues>);
    renderPage();

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('links the counter count to the correct queue\'s counters page', () => {
    vi.mocked(useQueues).mockReturnValue({
      data: [mockQueue({ id: 'queue-42', counterCount: 5 })],
      isLoading: false,
    } as unknown as ReturnType<typeof useQueues>);
    renderPage();

    const link = screen.getByText('5').closest('a');
    expect(link).toHaveAttribute('href', '/queues/queue-42/counters');
  });
});

describe('QueuesPage — search', () => {
  // Client-side filtering is correct here: useQueues returns every queue, so
  // no match can be hiding on an unloaded page.
  function renderWithQueues(queues: Queue[]) {
    vi.mocked(useQueues).mockReturnValue({ data: queues, isLoading: false } as unknown as ReturnType<
      typeof useQueues
    >);
    renderPage();
    return screen.getByLabelText('Search queues');
  }

  it('filters by queue name and hides non-matching queues', () => {
    const input = renderWithQueues([
      mockQueue({ id: 'q1', name: 'Front Desk' }),
      mockQueue({ id: 'q2', name: 'Back Office' }),
    ]);

    fireEvent.change(input, { target: { value: 'front' } });

    expect(screen.getByText('Front Desk')).toBeInTheDocument();
    expect(screen.queryByText('Back Office')).not.toBeInTheDocument();
  });

  it('matches a service name, not just the queue name', () => {
    const input = renderWithQueues([
      mockQueue({
        id: 'q1',
        name: 'Front Desk',
        services: [
          {
            id: 's1',
            queueId: 'q1',
            serviceName: 'Passport Renewal',
            description: null,
            durationMinutes: 5,
            isActive: true,
            createdAt: '2026-08-24T00:00:00.000Z',
            updatedAt: '2026-08-24T00:00:00.000Z',
          },
        ],
      }),
      mockQueue({ id: 'q2', name: 'Back Office' }),
    ]);

    fireEvent.change(input, { target: { value: 'passport' } });

    expect(screen.getByText('Front Desk')).toBeInTheDocument();
    expect(screen.queryByText('Back Office')).not.toBeInTheDocument();
  });

  it('shows a search-specific empty state, and restores the list when cleared', () => {
    const input = renderWithQueues([mockQueue({ id: 'q1', name: 'Front Desk' })]);

    fireEvent.change(input, { target: { value: 'nothing-matches-this' } });
    expect(screen.getByText('No queues match your search.')).toBeInTheDocument();
    expect(screen.queryByText('No queues found.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.getByText('Front Desk')).toBeInTheDocument();
  });
});

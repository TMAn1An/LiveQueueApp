import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ServiceHistoryPage } from './ServiceHistoryPage';
import { useServiceHistory } from '../hooks/useServiceHistory';
import { useQueues } from '../hooks/useQueues';
import type { ServiceHistoryEntry } from '../types/serviceHistory';

vi.mock('../hooks/useServiceHistory', () => ({ useServiceHistory: vi.fn() }));
vi.mock('../hooks/useQueues', () => ({ useQueues: vi.fn() }));

function mockEntry(overrides: Partial<ServiceHistoryEntry> = {}): ServiceHistoryEntry {
  return {
    tokenId: 'token-1',
    serialNumber: 'A007',
    status: 'COMPLETED',
    deviceIdentifier: 'pixel-alpha-001',
    queue: { id: 'queue-1', name: 'Front Desk' },
    services: [{ id: 'service-1', name: 'Passport Renewal', durationMinutes: 10 }],
    counter: { id: 'counter-1', name: 'Counter 1' },
    formFields: [{ key: 'full_name', label: 'Full Name', type: 'text', value: 'Amina Rahman' }],
    createdAt: '2026-09-07T10:00:00.000Z',
    startedAt: '2026-09-07T10:05:00.000Z',
    completedAt: '2026-09-07T10:17:00.000Z',
    skippedAt: null,
    cancelledAt: null,
    skipReason: null,
    completionFeedback: null,
    actualDurationMinutes: 12,
    expectedDurationMinutes: 10,
    ...overrides,
  };
}

function mockResult(data: ServiceHistoryEntry[], total = data.length) {
  return {
    data: { data, pagination: { page: 1, pageSize: 20, total, totalPages: Math.ceil(total / 20) } },
    isLoading: false,
  } as unknown as ReturnType<typeof useServiceHistory>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useQueues).mockReturnValue({
    data: [{ id: 'queue-1', name: 'Front Desk' }],
  } as unknown as ReturnType<typeof useQueues>);
});

describe('ServiceHistoryPage', () => {
  it('asks for completed visits by default — a cancelled visit is not service given', () => {
    vi.mocked(useServiceHistory).mockReturnValue(mockResult([mockEntry()]));

    render(<ServiceHistoryPage />);

    expect(useServiceHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'COMPLETED', page: 1 }),
    );
  });

  it('shows the served details staff need for each visit', () => {
    vi.mocked(useServiceHistory).mockReturnValue(mockResult([mockEntry()]));

    render(<ServiceHistoryPage />);

    // Scoped to the table: "Front Desk" is also one of the queue filter's
    // options, and that copy is not what this test is about.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('A007')).toBeInTheDocument();
    expect(table.getByText('pixel-alpha-001')).toBeInTheDocument();
    expect(table.getByText('Front Desk')).toBeInTheDocument();
    expect(table.getByText('Passport Renewal')).toBeInTheDocument();
    expect(table.getByText('Amina Rahman')).toBeInTheDocument();
    expect(table.getByText('Counter 1')).toBeInTheDocument();
    expect(table.getByText('12 min')).toBeInTheDocument();
  });

  it('shows a skip reason and completion feedback only where they exist (ADR-042)', () => {
    vi.mocked(useServiceHistory).mockReturnValue(
      mockResult([
        mockEntry({ tokenId: 't-plain', serialNumber: 'A001' }),
        mockEntry({
          tokenId: 't-feedback',
          serialNumber: 'A002',
          completionFeedback: 'Please bring the original document next time.',
        }),
        mockEntry({
          tokenId: 't-skipped',
          serialNumber: 'A003',
          status: 'SKIPPED',
          completedAt: null,
          skippedAt: '2026-09-07T10:20:00.000Z',
          skipReason: { code: 'CUSTOMER_NOT_PRESENT', text: 'Person not present' },
        }),
      ]),
    );

    render(<ServiceHistoryPage />);

    const table = within(screen.getByRole('table'));
    expect(table.getByText('Person not present')).toBeInTheDocument();
    expect(table.getByText('Please bring the original document next time.')).toBeInTheDocument();
    // One reason, one feedback — the plain completion adds neither label.
    expect(table.getAllByText(/Reason:/)).toHaveLength(1);
    expect(table.getAllByText(/Feedback:/)).toHaveLength(1);
  });

  it('sends the status filter to the server and resets to the first page', () => {
    vi.mocked(useServiceHistory).mockReturnValue(mockResult([mockEntry()], 60));

    render(<ServiceHistoryPage />);
    fireEvent.click(screen.getByText('Next'));
    expect(useServiceHistory).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CANCELLED' } });

    expect(useServiceHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'CANCELLED', page: 1 }),
    );
  });

  it('distinguishes an empty history from an empty filtered result', () => {
    vi.mocked(useServiceHistory).mockReturnValue(mockResult([]));

    render(<ServiceHistoryPage />);
    expect(screen.getByText('No service history yet.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Queue'), { target: { value: 'queue-1' } });
    expect(screen.getByText('No visits match your search.')).toBeInTheDocument();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueueLivePage } from './QueueLivePage';
import { useQueue } from '../hooks/useQueues';
import { useCounters } from '../hooks/useCounters';
import { useLiveQueueTable } from '../hooks/useDashboard';
import type { Counter, Queue } from '../types/queue';
import type { LiveQueueTokenRow } from '../types/dashboard';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../hooks/useQueues');
vi.mock('../hooks/useCounters');
vi.mock('../hooks/useDashboard');
vi.mock('../hooks/useTokenActions', () => ({
  useCallToken: () => ({ mutate: vi.fn() }),
  useStartToken: () => ({ mutate: vi.fn() }),
  useCompleteToken: () => ({ mutate: vi.fn() }),
  useSkipToken: () => ({ mutate: vi.fn() }),
  useRecallToken: () => ({ mutate: vi.fn() }),
  useSetRequiredDuration: () => ({ mutate: vi.fn(), isPending: false }),
}));

function queue(overrides: Partial<Queue> = {}): Queue {
  return {
    id: 'qA',
    organizationId: 'org1',
    name: 'Pharmacy',
    description: null,
    status: 'ACTIVE',
    clientTerminology: null,
    tokenPrefix: 'A',
    startingNumber: 1,
    nextTokenNumber: 1,
    baseTimeMinutes: 5,
    defaultNotificationMinutes: 10,
    allowRepeatVisits: true,
    repeatRestrictionType: null,
    repeatRestrictionAmount: null,
    repeatRestrictionUnit: null,
    repeatRestrictionUntil: null,
    repeatIdentityMode: null,
    repeatIdentityFieldKey: null,
    timezone: null,
    allowMultipleServices: true,
    formVersion: 1,
    qrCodeUri: 'livequeue://queue/qA',
    deletedAt: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
    services: [],
    ...overrides,
  };
}

function counter(overrides: Partial<Counter> = {}): Counter {
  return {
    id: 'cA',
    queueId: 'qA',
    name: 'A1',
    status: 'ACTIVE',
    staffId: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function row(overrides: Partial<LiveQueueTokenRow> = {}): LiveQueueTokenRow {
  return {
    id: 't1',
    serialNumber: 'A001',
    status: 'WAITING',
    queue: { id: 'qA', name: 'Pharmacy' },
    services: [{ id: 's1', name: 'Collection' }],
    counter: null,
    position: 1,
    estimatedWaitMinutes: 5,
    estimatedReadyAt: null,
    actionEligibility: { eligible: true, reason: null },
    createdAt: '2026-09-09T00:00:00.000Z',
    calledAt: null,
    startedAt: null,
    deviceId: 'd1',
    formFields: [],
    ...overrides,
  } as LiveQueueTokenRow;
}

function mockTable(rows: LiveQueueTokenRow[]) {
  vi.mocked(useLiveQueueTable).mockReturnValue({
    data: { data: rows, pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 } },
    isLoading: false,
    isFetching: false,
  } as unknown as ReturnType<typeof useLiveQueueTable>);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/queues/qA/live']}>
      <Routes>
        <Route path="/queues/:queueId/live" element={<QueueLivePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useQueue).mockReturnValue({
    data: queue(),
    isLoading: false,
  } as unknown as ReturnType<typeof useQueue>);
  vi.mocked(useCounters).mockReturnValue({
    data: [counter()],
  } as unknown as ReturnType<typeof useCounters>);
  mockTable([row()]);
});

describe('QueueLivePage', () => {
  it('asks the API for this queue’s line only', () => {
    renderPage();

    expect(useLiveQueueTable).toHaveBeenCalledWith(1, 20, 'qA');
  });

  it('shows the queue it belongs to, and its own customers', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Pharmacy' })).toBeInTheDocument();
    expect(screen.getByText('A001')).toBeInTheDocument();
  });

  it('drops the Queue column, since every row is the same queue', () => {
    renderPage();

    expect(screen.queryByRole('columnheader', { name: 'Queue' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Position' })).toBeInTheDocument();
  });

  it('warns when this queue has no active counter of its own', () => {
    vi.mocked(useCounters).mockReturnValue({
      // Another queue's counters are simply not in this list, so an empty
      // one here means nobody can be called in this queue.
      data: [counter({ status: 'OFFLINE' })],
    } as unknown as ReturnType<typeof useCounters>);
    renderPage();

    expect(screen.getByText(/no active counter/i)).toBeInTheDocument();
  });

  it('says nothing about capacity when a counter is open', () => {
    renderPage();

    expect(screen.queryByText(/no active counter/i)).not.toBeInTheDocument();
    expect(screen.getByText('1 active counter')).toBeInTheDocument();
  });

  it('offers a way through to this queue’s counters and settings', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'Counters' })).toHaveAttribute(
      'href',
      '/queues/qA/counters',
    );
    expect(screen.getByRole('link', { name: 'Queue Settings' })).toHaveAttribute(
      'href',
      '/queues/qA',
    );
  });

  it('tells the operator plainly when nobody is in this line', () => {
    mockTable([]);
    renderPage();

    expect(screen.getByText(/Nobody is waiting, called, or in progress in this queue/i)).toBeInTheDocument();
  });
});

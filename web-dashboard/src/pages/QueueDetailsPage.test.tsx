import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueueDetailsPage } from './QueueDetailsPage';
import { useQueue, useUpdateQueue } from '../hooks/useQueues';
import type { Queue } from '../types/queue';

// V2 UX + Token Lifecycle checkpoint, Part D: this page previously had no
// test coverage at all and no Back/breadcrumb navigation. The heavy child
// sections (Services, Form Builder, Repeat Visits, Timezone, QR Code) are
// stubbed out here — each already has its own dedicated tests — so this
// file can focus on what changed: the breadcrumb and the explicit Open
// Queue action.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ organization: { id: 'org1', name: 'Acme', timezone: null }, hasPermission: () => true }),
}));
vi.mock('../hooks/useQueues');
vi.mock('../components/ServicesManager', () => ({ ServicesManager: () => null }));
vi.mock('../components/FormBuilder', () => ({ FormBuilder: () => null }));
vi.mock('../components/RepeatVisitPolicy', () => ({ RepeatVisitPolicy: () => null }));
vi.mock('../components/QueueTimezoneSetting', () => ({ QueueTimezoneSetting: () => null }));
vi.mock('../components/QrCodeDisplay', () => ({ QrCodeDisplay: () => null }));

function mockQueue(overrides: Partial<Queue> = {}): Queue {
  return {
    id: 'queue-42',
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
    qrCodeUri: 'livequeue://queue/queue-42',
    deletedAt: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    services: [],
    counterCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useUpdateQueue).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
    typeof useUpdateQueue
  >);
});

function renderPage(queueId = 'queue-42') {
  return render(
    <MemoryRouter initialEntries={[`/queues/${queueId}`]}>
      <Routes>
        <Route path="/queues/:queueId" element={<QueueDetailsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('QueueDetailsPage — navigation', () => {
  it('shows a Back to Queues link and a Dashboard / Queues / {name} breadcrumb', () => {
    vi.mocked(useQueue).mockReturnValue({ data: mockQueue(), isLoading: false } as unknown as ReturnType<
      typeof useQueue
    >);
    renderPage();

    const backLink = screen.getByRole('link', { name: '← Back to Queues' });
    expect(backLink).toHaveAttribute('href', '/queues');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Dashboard/Queues/Pharmacy',
    );
  });

  it('has an explicit Open Queue action, same tier as Manage Counters', () => {
    vi.mocked(useQueue).mockReturnValue({ data: mockQueue(), isLoading: false } as unknown as ReturnType<
      typeof useQueue
    >);
    renderPage();

    expect(screen.getByRole('link', { name: 'Open Queue' })).toHaveAttribute(
      'href',
      '/queues/queue-42/live',
    );
    expect(screen.getByRole('link', { name: 'Manage Counters' })).toHaveAttribute(
      'href',
      '/queues/queue-42/counters',
    );
  });
});

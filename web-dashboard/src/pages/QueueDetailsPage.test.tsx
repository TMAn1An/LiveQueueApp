import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueueDetailsPage } from './QueueDetailsPage';
import { useQueue, useRecommendedJourney, useSetRecommendedJourney, useUpdateQueue } from '../hooks/useQueues';
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
vi.mock('../components/QueueSchedule', () => ({ QueueSchedule: () => null }));
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
    requireServiceStartOtp: true,
    scheduleEnabled: false,
    scheduleDailyCapacity: null,
    scheduleVisibleToCustomers: true,
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
  vi.mocked(useRecommendedJourney).mockReturnValue({ data: { serviceIds: [], unroutableServiceIds: [] }, isLoading: false } as unknown as ReturnType<typeof useRecommendedJourney>);
  vi.mocked(useSetRecommendedJourney).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useSetRecommendedJourney>);
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

// ADR-059: one shared, bordered tab bar; ADR-055: the creation-only
// settings are shown read-only and locked, with no toggle anywhere.
describe('QueueDetailsPage — settings tabs and locked creation settings', () => {
  const TABS = [
    'General & Timezone',
    'Services & Verification',
    'Join Form',
    'Schedule & Capacity',
    'Repeat Visits',
    'QR Code & Entry',
    'View All',
  ];

  function renderWithTab(tab?: string, overrides: Partial<Queue> = {}) {
    vi.mocked(useQueue).mockReturnValue({
      data: mockQueue(overrides),
      isLoading: false,
    } as unknown as ReturnType<typeof useQueue>);
    return render(
      <MemoryRouter initialEntries={[`/queues/queue-42${tab ? `?tab=${tab}` : ''}`]}>
        <Routes>
          <Route path="/queues/:queueId" element={<QueueDetailsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('renders every tab as a bordered, full-size control at a readable size', () => {
    renderWithTab();
    const nav = screen.getByRole('navigation', { name: 'Queue settings sections' });
    for (const label of TABS) {
      const tab = screen.getByRole('button', { name: label });
      expect(nav).toContainElement(tab);
      expect(tab.className).toContain('border');
      expect(tab.className).toContain('h-10');
      expect(tab.className).toContain('text-sm');
      expect(tab.className).not.toContain('text-xs');
    }
  });

  it('marks the current tab with aria-current and a check mark, not colour alone', () => {
    renderWithTab('repeat');
    const active = screen.getByRole('button', { name: 'Repeat Visits' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active.querySelector('svg')).not.toBeNull();
    expect(active.className).toContain('bg-brand-600');
    const inactive = screen.getByRole('button', { name: 'Join Form' });
    expect(inactive).not.toHaveAttribute('aria-current');
    expect(inactive.className).toContain('bg-surface');
  });

  it('shows the creation-only setting locked, with no switch to flip', () => {
    renderWithTab('services', { requireServiceStartOtp: false });
    expect(screen.getByText('Fixed at Creation')).toBeInTheDocument();
    expect(screen.getByText('Not required')).toBeInTheDocument();
    expect(screen.getAllByText('Locked')).toHaveLength(1);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    // ADR-071 D1: the multiple-services setting is retired.
    expect(screen.queryByText(/multiple services/i)).not.toBeInTheDocument();
    expect(screen.queryByText('One per visit')).not.toBeInTheDocument();
  });

  it('shows an existing queue’s stored verification value; a retired false never shows', () => {
    renderWithTab('services', { requireServiceStartOtp: true, allowMultipleServices: false });
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByText('One per visit')).not.toBeInTheDocument();
  });
});

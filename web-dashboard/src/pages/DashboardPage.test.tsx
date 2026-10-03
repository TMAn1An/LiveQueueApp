import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { useDashboardStats } from '../hooks/useDashboard';
import { useCreateQueue, useQueues } from '../hooks/useQueues';
import type { Queue } from '../types/queue';

const mockHasPermission = vi.fn(() => true);
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    staff: { id: 's1', name: 'Rafi', role: 'OWNER' },
    organization: { id: 'o1', name: 'Acme' },
    hasPermission: mockHasPermission,
  }),
}));
vi.mock('../hooks/useDashboard');
vi.mock('../hooks/useStaff', () => ({ useAdmins: () => ({ admins: [] }), useStaffList: () => ({ data: { data: [] }, isLoading: false }) }));
vi.mock('../hooks/useQueues');

function queue(overrides: Partial<Queue> = {}): Queue {
  return {
    id: 'q1',
    name: 'Front Desk',
    description: null,
    status: 'ACTIVE',
    tokenPrefix: 'A',
    deletedAt: null,
    waitingCount: 2,
    activeCounterCount: 1,
    counterCount: 3,
    services: [],
    ...overrides,
  } as Queue;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPermission.mockReturnValue(true);
  vi.mocked(useDashboardStats).mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<
    typeof useDashboardStats
  >);
  vi.mocked(useCreateQueue).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as unknown as ReturnType<
    typeof useCreateQueue
  >);
});

function renderWith(queues: Queue[]) {
  vi.mocked(useQueues).mockReturnValue({ data: queues, isLoading: false } as unknown as ReturnType<
    typeof useQueues
  >);
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

// ADR-059: Create Queue opens the real form wherever it appears, and is
// absent for anyone who may not create queues.
describe('DashboardPage — Create Queue actions', () => {
  it('the header action opens the create form rather than linking away', () => {
    renderWith([queue()]);
    const button = screen.getByRole('button', { name: 'Create Queue' });
    expect(button.closest('a')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Create Queue' })).toBeInTheDocument();
  });

  it('the first-time empty state offers the same action', () => {
    renderWith([]);
    const buttons = screen.getAllByRole('button', { name: 'Create Queue' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(screen.getByRole('dialog', { name: 'Create Queue' })).toBeInTheDocument();
  });

  it('STAFF sees no Create Queue action — header or empty state — and is told who can', () => {
    mockHasPermission.mockReturnValue(false);
    renderWith([]);
    expect(screen.queryByRole('button', { name: 'Create Queue' })).not.toBeInTheDocument();
    expect(screen.getByText(/An owner or admin creates queues/)).toBeInTheDocument();
  });

  it('no longer duplicates the queues link in the header', () => {
    renderWith([queue()]);
    expect(screen.queryByRole('link', { name: 'View All Queues' })).not.toBeInTheDocument();
    const manage = screen.getByRole('link', { name: 'Manage all queues' });
    expect(manage).toHaveAttribute('href', '/queues');
    // A real, readable action — not the old text-xs link.
    expect(manage.className).toContain('h-9');
    expect(manage.className).toContain('text-sm');
  });
});

describe('DashboardPage — queue card', () => {
  it('labels the counters action without repeating the count shown above it', () => {
    renderWith([queue({ counterCount: 3 })]);
    const manage = screen.getByRole('link', { name: 'Manage Counters' });
    expect(manage).toHaveAttribute('href', '/queues/q1/counters');
    expect(screen.queryByText(/Manage Counters \(/)).not.toBeInTheDocument();
    // The count itself still appears in the stats.
    expect(screen.getByText('/ 3')).toBeInTheDocument();
  });

  it('renders card actions as single links, never a button inside a link', () => {
    renderWith([queue()]);
    for (const name of ['Open Queue', 'Manage Counters', 'Settings']) {
      expect(screen.getByRole('link', { name }).querySelector('button')).toBeNull();
    }
  });
});

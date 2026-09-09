import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServicesManager } from './ServicesManager';
import {
  useCreateService,
  useDeleteService,
  useSetServiceStatus,
  useUpdateService,
} from '../hooks/useServices';
import type { QueueServiceItem } from '../types/queue';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('./PermissionGate', () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../hooks/useServices');

function service(overrides: Partial<QueueServiceItem> = {}): QueueServiceItem {
  return {
    id: 's1',
    queueId: 'q1',
    serviceName: 'General Inquiry',
    description: null,
    durationMinutes: 5,
    isActive: true,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCreateService).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
    typeof useCreateService
  >);
  vi.mocked(useUpdateService).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
    typeof useUpdateService
  >);
  vi.mocked(useSetServiceStatus).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSetServiceStatus>);
});

// V2 Product Completion checkpoint, Part B: deleting a service previously
// called the mutation directly on click, with no confirmation of any kind.
describe('ServicesManager — delete confirmation', () => {
  it('does not call the delete mutation until Delete is clicked and confirmed', async () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteService).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<
      typeof useDeleteService
    >);
    render(<ServicesManager queueId="q1" services={[service({ serviceName: 'Passport Renewal' })]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByText('Delete service "Passport Renewal"?')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Delete service "Passport Renewal"?')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('calls the existing delete mutation once confirmed', async () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteService).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<
      typeof useDeleteService
    >);
    render(<ServicesManager queueId="q1" services={[service({ id: 'service-42' })]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    await userEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(mutate).toHaveBeenCalledWith('service-42', expect.anything());
  });
});

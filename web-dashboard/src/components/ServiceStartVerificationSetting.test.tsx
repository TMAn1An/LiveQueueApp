import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ServiceStartVerificationSetting } from './ServiceStartVerificationSetting';
import { useUpdateQueue } from '../hooks/useQueues';
import { ApiError } from '../api/client';
import type { Queue } from '../types/queue';

const mockHasPermission = vi.fn(() => true);
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock('../hooks/useQueues');

const mutateAsync = vi.fn();

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
    repeatRestrictionType: null,
    repeatRestrictionAmount: null,
    repeatRestrictionUnit: null,
    repeatRestrictionUntil: null,
    repeatIdentityMode: null,
    repeatIdentityFieldKey: null,
    timezone: null,
    allowMultipleServices: true,
    requireServiceStartOtp: true,
    formVersion: 1,
    qrCodeUri: 'livequeue://queue/q1',
    deletedAt: null,
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
    services: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPermission.mockReturnValue(true);
  mutateAsync.mockResolvedValue({});
  vi.mocked(useUpdateQueue).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateQueue>);
});

function toggle() {
  return screen.getByRole('switch', { name: 'Service-start verification code' });
}

describe('ServiceStartVerificationSetting (ADR-041)', () => {
  it('shows the persisted value — on', () => {
    render(<ServiceStartVerificationSetting queue={mockQueue({ requireServiceStartOtp: true })} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/staff enter the code the customer shows/)).toBeInTheDocument();
  });

  it('shows the persisted value — off', () => {
    render(<ServiceStartVerificationSetting queue={mockQueue({ requireServiceStartOtp: false })} />);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/staff start service directly/)).toBeInTheDocument();
  });

  it('saves the change as soon as it is toggled', async () => {
    render(<ServiceStartVerificationSetting queue={mockQueue({ requireServiceStartOtp: true })} />);
    fireEvent.click(toggle());
    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ requireServiceStartOtp: false }));
  });

  it('shows the backend error when the save is refused', async () => {
    mutateAsync.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You do not have permission.'));
    render(<ServiceStartVerificationSetting queue={mockQueue()} />);
    fireEvent.click(toggle());
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission.');
  });

  it('a role without manage_queues sees the setting but cannot change it', () => {
    mockHasPermission.mockReturnValue(false);
    render(<ServiceStartVerificationSetting queue={mockQueue()} />);
    expect(toggle()).toBeDisabled();
    fireEvent.click(toggle());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('an archived queue is read-only', () => {
    render(<ServiceStartVerificationSetting queue={mockQueue({ deletedAt: '2026-09-30T00:00:00.000Z' })} />);
    expect(toggle()).toBeDisabled();
  });
});

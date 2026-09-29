import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueueSchedule } from './QueueSchedule';
import { useUpdateQueue } from '../hooks/useQueues';
import {
  useCreateQueueSession,
  useDeleteQueueSession,
  useQueueSessions,
  useUpdateQueueSession,
} from '../hooks/useQueueSchedule';
import type { Queue, QueueSession } from '../types/queue';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../hooks/useQueues');
vi.mock('../hooks/useQueueSchedule');

const updateQueueMutateAsync = vi.fn();
const createSessionMutateAsync = vi.fn();
const updateSessionMutateAsync = vi.fn();
const deleteSessionMutate = vi.fn();

function queue(overrides: Partial<Queue> = {}): Queue {
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
    scheduleEnabled: false,
    scheduleDailyCapacity: null,
    scheduleVisibleToCustomers: true,
    formVersion: 1,
    qrCodeUri: 'livequeue://queue/q1',
    deletedAt: null,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    services: [],
    ...overrides,
  };
}

function session(overrides: Partial<QueueSession> = {}): QueueSession {
  return { id: 's1', weekday: 1, startMinute: 540, endMinute: 720, capacity: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useUpdateQueue).mockReturnValue({
    mutateAsync: updateQueueMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateQueue>);
  vi.mocked(useQueueSessions).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
    typeof useQueueSessions
  >);
  vi.mocked(useCreateQueueSession).mockReturnValue({
    mutateAsync: createSessionMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateQueueSession>);
  vi.mocked(useUpdateQueueSession).mockReturnValue({
    mutateAsync: updateSessionMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateQueueSession>);
  vi.mocked(useDeleteQueueSession).mockReturnValue({
    mutate: deleteSessionMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteQueueSession>);
});

describe('QueueSchedule', () => {
  it('shows only the master switch while scheduling is off', () => {
    render(<QueueSchedule queue={queue({ scheduleEnabled: false })} />);
    expect(screen.getByRole('switch', { name: /restrict this queue to a weekly schedule/i })).toBeInTheDocument();
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument();
  });

  it('turning the switch on calls updateQueue with scheduleEnabled: true', async () => {
    const user = userEvent.setup();
    render(<QueueSchedule queue={queue({ scheduleEnabled: false })} />);

    await user.click(screen.getByRole('switch', { name: /restrict this queue to a weekly schedule/i }));

    expect(updateQueueMutateAsync).toHaveBeenCalledWith({ scheduleEnabled: true });
  });

  it('shows every weekday as Closed when no sessions exist yet', () => {
    render(<QueueSchedule queue={queue({ scheduleEnabled: true })} />);
    expect(screen.getAllByText('Closed')).toHaveLength(7);
  });

  it('lists an existing session under its own weekday', () => {
    vi.mocked(useQueueSessions).mockReturnValue({
      data: [session({ weekday: 2, startMinute: 540, endMinute: 720 })],
      isLoading: false,
    } as unknown as ReturnType<typeof useQueueSessions>);

    render(<QueueSchedule queue={queue({ scheduleEnabled: true })} />);

    expect(screen.getByText('09:00–12:00')).toBeInTheDocument();
    // Six weekdays remain closed, one (Tuesday) now has a session instead.
    expect(screen.getAllByText('Closed')).toHaveLength(6);
  });

  it('adding a session sends the typed start/end/capacity for that weekday', async () => {
    const user = userEvent.setup();
    render(<QueueSchedule queue={queue({ scheduleEnabled: true })} />);

    const [startInput] = screen.getAllByLabelText(/Sunday session start time/i);
    const [endInput] = screen.getAllByLabelText(/Sunday session end time/i);
    const [capacityInput] = screen.getAllByLabelText(/Sunday session capacity/i);
    await user.clear(startInput);
    await user.type(startInput, '09:00');
    await user.clear(endInput);
    await user.type(endInput, '12:00');
    await user.type(capacityInput, '20');

    const [addButton] = screen.getAllByRole('button', { name: 'Add session' });
    await user.click(addButton);

    expect(createSessionMutateAsync).toHaveBeenCalledWith({
      weekday: 0,
      startMinute: 540,
      endMinute: 720,
      capacity: 20,
    });
  });

  it('disables Add when the end time is not after the start time', async () => {
    const user = userEvent.setup();
    render(<QueueSchedule queue={queue({ scheduleEnabled: true })} />);

    const [startInput] = screen.getAllByLabelText(/Sunday session start time/i);
    const [endInput] = screen.getAllByLabelText(/Sunday session end time/i);
    await user.clear(startInput);
    await user.type(startInput, '12:00');
    await user.clear(endInput);
    await user.type(endInput, '09:00');

    const [addButton] = screen.getAllByRole('button', { name: 'Add session' });
    expect(addButton).toBeDisabled();
  });

  it('daily capacity Save only appears once the value changes, and saves the parsed number', async () => {
    const user = userEvent.setup();
    render(<QueueSchedule queue={queue({ scheduleEnabled: true, scheduleDailyCapacity: null })} />);

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Daily capacity/i), '50');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateQueueMutateAsync).toHaveBeenCalledWith({ scheduleDailyCapacity: 50 });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
import { ApiError } from '../api/client';

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

  it('ADR-049: turning the schedule off while a per-session repeat limit depends on it shows the refusal', async () => {
    const user = userEvent.setup();
    const message =
      'A per-session repeat limit needs the weekly schedule. Turn the schedule on, or set the repeat restriction scope to Entire queue first.';
    updateQueueMutateAsync.mockRejectedValueOnce(new ApiError(422, 'REPEAT_SCOPE_REQUIRES_SCHEDULE', message));
    render(<QueueSchedule queue={queue({ scheduleEnabled: true })} />);

    await user.click(screen.getByRole('switch', { name: /restrict this queue to a weekly schedule/i }));

    expect(updateQueueMutateAsync).toHaveBeenCalledWith({ scheduleEnabled: false });
    expect(await screen.findByText(message)).toBeInTheDocument();
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

describe('QueueSchedule — sessions may not overlap', () => {
  function withMondaySession() {
    vi.mocked(useQueueSessions).mockReturnValue({
      data: [session({ id: 'mon', weekday: 1, startMinute: 540, endMinute: 720 })],
      isLoading: false,
    } as unknown as ReturnType<typeof useQueueSessions>);
    render(<QueueSchedule queue={queue({ scheduleEnabled: true })} />);
  }

  it('suggests the next free slot after the day’s last session', () => {
    withMondaySession();

    expect(screen.getByLabelText('New Monday session start time')).toHaveValue('12:00');
    expect(screen.getByLabelText('New Monday session end time')).toHaveValue('15:00');
    expect(screen.getByLabelText('New Sunday session start time')).toHaveValue('09:00');
  });

  it('flags an overlapping new session and will not add it', () => {
    withMondaySession();

    fireEvent.change(screen.getByLabelText('New Monday session start time'), { target: { value: '10:00' } });

    expect(screen.getByText('Overlaps the 09:00–12:00 session.')).toBeInTheDocument();
    const addButtons = screen.getAllByRole('button', { name: 'Add session' });
    expect(addButtons[1]).toBeDisabled();
  });

  it('allows a back-to-back session', () => {
    withMondaySession();

    fireEvent.change(screen.getByLabelText('New Monday session start time'), { target: { value: '12:00' } });
    fireEvent.change(screen.getByLabelText('New Monday session end time'), { target: { value: '13:00' } });

    expect(screen.queryByText(/Overlaps/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add session' })[1]).toBeEnabled();
  });

  it('lays the days out in columns and shows capacity beside the hours', () => {
    withMondaySession();

    expect(screen.getByText('09:00–12:00')).toBeInTheDocument();
    expect(screen.getByText('Unlimited capacity')).toBeInTheDocument();
    expect(screen.getAllByText('Closed')).toHaveLength(6);
  });
});

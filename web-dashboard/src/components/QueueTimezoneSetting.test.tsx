import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueueTimezoneSetting } from './QueueTimezoneSetting';
import { useUpdateQueue } from '../hooks/useQueues';
import type { Queue } from '../types/queue';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../hooks/useQueues');
vi.mock('../utils/timezone', () => ({
  browserTimezone: () => 'Asia/Dhaka',
  supportedTimezones: () => ['Asia/Dhaka', 'Europe/London'],
}));

const mutateAsync = vi.fn();

function renderSetting(queueTimezone: string | null, organizationTimezone: string | null) {
  return render(
    <QueueTimezoneSetting
      queue={{ id: 'q1', timezone: queueTimezone, deletedAt: null } as unknown as Queue}
      organizationTimezone={organizationTimezone}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue(undefined);
  vi.mocked(useUpdateQueue).mockReturnValue({ mutateAsync, isPending: false } as unknown as ReturnType<
    typeof useUpdateQueue
  >);
});

describe('QueueTimezoneSetting', () => {
  it('shows the zone inherited from the organization instead of "No timezone set"', () => {
    renderSetting(null, 'Asia/Dhaka');

    expect(screen.getByText('Asia/Dhaka')).toBeInTheDocument();
    expect(screen.getByText(/Inherited from your organization/)).toBeInTheDocument();
    expect(screen.queryByText('No timezone set.')).not.toBeInTheDocument();
  });

  it('offers this device’s timezone in one click when the queue has none', async () => {
    renderSetting(null, null);

    await userEvent.click(screen.getByRole('button', { name: /Use this device’s timezone \(Asia\/Dhaka\)/ }));

    expect(mutateAsync).toHaveBeenCalledWith({ timezone: 'Asia/Dhaka' });
  });

  it('does not offer it when the queue already runs on this device’s zone', () => {
    renderSetting(null, 'Asia/Dhaka');

    expect(screen.queryByRole('button', { name: /Use this device’s timezone/ })).not.toBeInTheDocument();
  });

  it('offers it when the device is somewhere else than the queue', () => {
    renderSetting('Europe/London', 'Europe/London');

    expect(screen.getByRole('button', { name: /Use this device’s timezone \(Asia\/Dhaka\)/ })).toBeInTheDocument();
  });
});

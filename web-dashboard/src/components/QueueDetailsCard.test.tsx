import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueueDetailsCard } from './QueueDetailsCard';
import { useUpdateQueue } from '../hooks/useQueues';
import type { Queue } from '../types/queue';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../hooks/useQueues');

const mutate = vi.fn();

const queue = {
  id: 'q1',
  name: 'Line',
  description: null,
  tokenPrefix: 'A',
  baseTimeMinutes: 5,
  defaultNotificationMinutes: 10,
  allowMultipleServices: true,
  formVersion: 3,
  deletedAt: null,
} as unknown as Queue;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useUpdateQueue).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useUpdateQueue>);
});

describe('QueueDetailsCard — what is shown is what can be edited', () => {
  it('shows every detail, including the name and multiple-services rule', () => {
    render(<QueueDetailsCard queue={queue} />);

    for (const label of ['Name', 'Token prefix', 'Base time', 'Reminder', 'Multiple services', 'Form version', 'Description']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Line')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
  });

  it('edits the same fields it shows — token prefix, base time and reminder included', async () => {
    render(<QueueDetailsCard queue={queue} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Details' }));

    await userEvent.clear(screen.getByLabelText('Token prefix'));
    await userEvent.type(screen.getByLabelText('Token prefix'), 'B');
    await userEvent.clear(screen.getByLabelText('Base time (minutes)'));
    await userEvent.type(screen.getByLabelText('Base time (minutes)'), '7');
    await userEvent.clear(screen.getByLabelText('Reminder (minutes before turn)'));
    await userEvent.type(screen.getByLabelText('Reminder (minutes before turn)'), '15');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutate).toHaveBeenCalledWith(
      {
        name: 'Line',
        description: '',
        tokenPrefix: 'B',
        baseTimeMinutes: 7,
        defaultNotificationMinutes: 15,
        allowMultipleServices: true,
      },
      expect.anything(),
    );
  });

  it('keeps form version read-only and refuses an empty prefix', async () => {
    render(<QueueDetailsCard queue={queue} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Details' }));

    expect(screen.queryByLabelText(/form version/i)).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Token prefix'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

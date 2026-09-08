import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepeatVisitPolicy } from './RepeatVisitPolicy';
import { useFormFields } from '../hooks/useFormFields';
import { useUpdateQueue } from '../hooks/useQueues';
import type { Queue, QueueFormField } from '../types/queue';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../hooks/useFormFields');
vi.mock('../hooks/useQueues');

const mutateAsync = vi.fn();

function field(overrides: Partial<QueueFormField>): QueueFormField {
  return {
    id: 'f1',
    queueId: 'q1',
    key: 'nid',
    label: 'NID Number',
    type: 'text',
    required: true,
    placeholder: null,
    options: [],
    sortOrder: 0,
    version: 1,
    ...overrides,
  };
}

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
    repeatRestrictionPeriod: null,
    repeatIdentityMode: null,
    repeatIdentityFieldKey: null,
    timezone: null,
    allowMultipleServices: true,
    formVersion: 1,
    qrCodeUri: 'livequeue://queue/q1',
    deletedAt: null,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    services: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue(undefined);
  vi.mocked(useUpdateQueue).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateQueue>);
  vi.mocked(useFormFields).mockReturnValue({
    data: {
      formVersion: 1,
      fields: [
        field({}),
        field({ id: 'f2', key: 'optional_id', label: 'Optional ID', required: false }),
        field({ id: 'f3', key: 'agree', label: 'Agree', type: 'checkbox' }),
      ],
    },
  } as unknown as ReturnType<typeof useFormFields>);
});

describe('RepeatVisitPolicy', () => {
  it('says plainly that an unrestricted queue has no limit', () => {
    render(<RepeatVisitPolicy queue={queue()} />);

    expect(screen.getByText(/join this queue as often as they like/i)).toBeInTheDocument();
  });

  it('names the question a restricted queue identifies customers by', () => {
    render(
      <RepeatVisitPolicy
        queue={queue({
          allowRepeatVisits: false,
          repeatRestrictionPeriod: 'DAILY',
          repeatIdentityMode: 'CUSTOM_FIELD',
          repeatIdentityFieldKey: 'nid',
          timezone: 'Asia/Dhaka',
        })}
      />,
    );

    expect(screen.getByText('Once per day')).toBeInTheDocument();
    expect(screen.getByText(/Asia\/Dhaka/)).toBeInTheDocument();
    expect(screen.getByText(/NID Number/)).toBeInTheDocument();
  });

  it('warns that a queue restricted before this feature is refusing customers', () => {
    render(<RepeatVisitPolicy queue={queue({ allowRepeatVisits: false })} />);

    expect(screen.getByText(/not accepting customers/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up identification/i })).toBeInTheDocument();
  });

  it('offers only questions that can actually identify a person', async () => {
    render(<RepeatVisitPolicy queue={queue()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));

    const select = screen.getByLabelText(/Which form question identifies the customer/i);
    expect(select).toHaveTextContent('NID Number');
    // Optional, and a checkbox: neither can hold one person's identity.
    expect(select).not.toHaveTextContent('Optional ID');
    expect(select).not.toHaveTextContent('Agree');
  });

  it('sends the whole policy together when a restriction is saved', async () => {
    render(<RepeatVisitPolicy queue={queue()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));
    await userEvent.selectOptions(
      screen.getByLabelText(/How often may one customer use this queue/i),
      'MONTHLY',
    );
    await userEvent.selectOptions(screen.getByLabelText(/Which timezone/i), 'Asia/Dhaka');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      allowRepeatVisits: false,
      repeatRestrictionPeriod: 'MONTHLY',
      repeatIdentityMode: 'CUSTOM_FIELD',
      repeatIdentityFieldKey: 'nid',
      timezone: 'Asia/Dhaka',
    });
  });

  it('will not save a recurring limit with no timezone chosen', async () => {
    render(<RepeatVisitPolicy queue={queue()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));
    await userEvent.selectOptions(
      screen.getByLabelText(/How often may one customer use this queue/i),
      'WEEKLY',
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('clears the restriction without sending stale identity settings', async () => {
    render(
      <RepeatVisitPolicy
        queue={queue({
          allowRepeatVisits: false,
          repeatRestrictionPeriod: 'ONCE_EVER',
          repeatIdentityMode: 'CUSTOM_FIELD',
          repeatIdentityFieldKey: 'nid',
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Unlimited visits/i));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith({ allowRepeatVisits: true });
  });

  it('points the operator at the form builder when no question can identify anyone', async () => {
    vi.mocked(useFormFields).mockReturnValue({
      data: { formVersion: 1, fields: [field({ key: 'agree', type: 'checkbox' })] },
    } as unknown as ReturnType<typeof useFormFields>);
    render(<RepeatVisitPolicy queue={queue()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));

    expect(screen.getByText(/no question that could identify a customer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

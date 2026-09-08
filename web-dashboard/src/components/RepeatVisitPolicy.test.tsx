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
    repeatRestrictionType: null,
    repeatRestrictionAmount: null,
    repeatRestrictionUnit: null,
    repeatRestrictionUntil: null,
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

function renderPolicy(overrides: Partial<Queue> = {}, timezone: string | null = 'Asia/Dhaka') {
  return render(<RepeatVisitPolicy queue={queue(overrides)} effectiveTimezone={timezone} />);
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
    renderPolicy();

    expect(screen.getByText(/join this queue as often as they like/i)).toBeInTheDocument();
  });

  it('no longer offers the old fixed periods or a timezone picker', async () => {
    renderPolicy();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));

    expect(screen.queryByText('Once per day')).not.toBeInTheDocument();
    expect(screen.queryByText('Once per week')).not.toBeInTheDocument();
    expect(screen.queryByText('Once per month')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Which timezone does this queue run in/i)).not.toBeInTheDocument();
  });

  it('summarises a duration window as a sentence', () => {
    renderPolicy({
      allowRepeatVisits: false,
      repeatRestrictionType: 'DURATION',
      repeatRestrictionAmount: 30,
      repeatRestrictionUnit: 'DAY',
      repeatIdentityMode: 'CUSTOM_FIELD',
      repeatIdentityFieldKey: 'nid',
    });

    expect(screen.getByText(/may return 30 days after being served/i)).toBeInTheDocument();
    expect(screen.getByText(/NID Number/)).toBeInTheDocument();
  });

  it('summarises a once-ever queue', () => {
    renderPolicy({
      allowRepeatVisits: false,
      repeatRestrictionType: 'ONCE_EVER',
      repeatIdentityMode: 'CUSTOM_FIELD',
      repeatIdentityFieldKey: 'nid',
    });

    expect(screen.getByText(/once, ever/i)).toBeInTheDocument();
  });

  it('names the queue’s clock for a fixed cutoff', () => {
    renderPolicy({
      allowRepeatVisits: false,
      repeatRestrictionType: 'UNTIL_DATETIME',
      // 17:59 UTC is 23:59 in Dhaka.
      repeatRestrictionUntil: '2026-12-31T17:59:00.000Z',
      repeatIdentityMode: 'CUSTOM_FIELD',
      repeatIdentityFieldKey: 'nid',
    });

    expect(screen.getByText(/Nobody may return until/i)).toBeInTheDocument();
    expect(screen.getByText(/Asia\/Dhaka/)).toBeInTheDocument();
  });

  it('warns that a queue restricted before this feature is refusing customers', () => {
    renderPolicy({ allowRepeatVisits: false });

    expect(screen.getByText(/not accepting customers/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up identification/i })).toBeInTheDocument();
  });

  it('sends a custom duration window', async () => {
    renderPolicy();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));
    await userEvent.click(screen.getByLabelText('Allow again after'));
    await userEvent.clear(screen.getByLabelText('Amount'));
    await userEvent.type(screen.getByLabelText('Amount'), '90');
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'DAY');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      allowRepeatVisits: false,
      repeatRestrictionType: 'DURATION',
      repeatRestrictionAmount: 90,
      repeatRestrictionUnit: 'DAY',
      repeatRestrictionUntilLocal: null,
      repeatIdentityMode: 'CUSTOM_FIELD',
      repeatIdentityFieldKey: 'nid',
    });
  });

  it('sends a once-ever window with no amount or cutoff', async () => {
    renderPolicy();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));
    await userEvent.click(screen.getByLabelText('Only once ever'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      allowRepeatVisits: false,
      repeatRestrictionType: 'ONCE_EVER',
      repeatRestrictionAmount: null,
      repeatRestrictionUnit: null,
      repeatRestrictionUntilLocal: null,
      repeatIdentityMode: 'CUSTOM_FIELD',
      repeatIdentityFieldKey: 'nid',
    });
  });

  it('sends a fixed cutoff on the queue’s own clock', async () => {
    renderPolicy();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));
    await userEvent.click(screen.getByLabelText('Block until a date and time'));
    await userEvent.type(screen.getByLabelText('Restriction ends'), '2026-12-31T23:59');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        repeatRestrictionType: 'UNTIL_DATETIME',
        repeatRestrictionUntilLocal: '2026-12-31T23:59',
      }),
    );
  });

  it('will not save a month window when the queue has no timezone', async () => {
    renderPolicy({}, null);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));
    await userEvent.click(screen.getByLabelText('Allow again after'));
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'MONTH');

    expect(screen.getByText(/has no timezone yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('needs no timezone for a window measured in hours', async () => {
    renderPolicy({}, null);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));
    await userEvent.click(screen.getByLabelText('Allow again after'));
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'HOUR');

    expect(screen.queryByText(/has no timezone yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('offers only questions that can actually identify a person', async () => {
    renderPolicy();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));

    const select = screen.getByLabelText(/Which form question identifies the customer/i);
    expect(select).toHaveTextContent('NID Number');
    // Optional, and a checkbox: neither can hold one person's identity.
    expect(select).not.toHaveTextContent('Optional ID');
    expect(select).not.toHaveTextContent('Agree');
  });

  it('clears the restriction without sending stale window settings', async () => {
    renderPolicy({
      allowRepeatVisits: false,
      repeatRestrictionType: 'ONCE_EVER',
      repeatIdentityMode: 'CUSTOM_FIELD',
      repeatIdentityFieldKey: 'nid',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Unlimited visits/i));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith({ allowRepeatVisits: true });
  });

  it('points the operator at the form builder when no question can identify anyone', async () => {
    vi.mocked(useFormFields).mockReturnValue({
      data: { formVersion: 1, fields: [field({ key: 'agree', type: 'checkbox' })] },
    } as unknown as ReturnType<typeof useFormFields>);
    renderPolicy();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(screen.getByLabelText(/Limit how often a customer returns/i));

    expect(screen.getByText(/no question that could identify a customer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

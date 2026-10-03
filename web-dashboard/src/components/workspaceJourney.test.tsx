import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { TokenActions } from './TokenActions';
import { ReferralDialog } from './ReferralDialog';
import { CreateQueueModal } from './CreateQueueModal';
import { RecommendedJourneyEditor } from './RecommendedJourneyEditor';
import { useMyCounter } from '../hooks/useCounters';
import { useCompleteToken, useSetRequiredDuration, useSkipToken, useStartToken } from '../hooks/useTokenActions';
import { useCreateQueue, useQueues, useRecommendedJourney, useSetRecommendedJourney } from '../hooks/useQueues';
import { useAdmins, useStaffList } from '../hooks/useStaff';
import { getReferralOptions } from '../api/token.api';

/**
 * ADR-069/070 dashboard behaviour: step-aware completion and referral,
 * the simplified Create Queue (first counter + who operates it), and the
 * recommended-order editor.
 */
let permissions: string[] = [];
let me = { id: 'admin1', role: 'ADMIN' };
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (p: string) => permissions.includes(p), staff: me }),
}));
vi.mock('../hooks/useCounters');
vi.mock('../hooks/useTokenActions');
vi.mock('../hooks/useQueues');
vi.mock('../hooks/useStaff');
vi.mock('../api/token.api', async (original) => ({
  ...(await original<typeof import('../api/token.api')>()),
  getReferralOptions: vi.fn(),
}));

const completeMutate = vi.fn();
const createQueue = vi.fn();
const saveOrder = vi.fn();

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['operate_tokens', 'manage_queues', 'manage_counters', 'manage_staff'];
  me = { id: 'admin1', role: 'ADMIN' };
  vi.mocked(useMyCounter).mockReturnValue({
    data: { id: 'c1', name: 'Registration Desk', status: 'ACTIVE', queueId: 'q1', queueName: 'Q' },
  } as unknown as ReturnType<typeof useMyCounter>);
  vi.mocked(useStartToken).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useStartToken>);
  vi.mocked(useSkipToken).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useSkipToken>);
  vi.mocked(useSetRequiredDuration).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<
    typeof useSetRequiredDuration
  >);
  vi.mocked(useCompleteToken).mockReturnValue({ mutate: completeMutate, isPending: false } as unknown as ReturnType<
    typeof useCompleteToken
  >);
  vi.mocked(useCreateQueue).mockReturnValue({ mutateAsync: createQueue, isPending: false } as unknown as ReturnType<
    typeof useCreateQueue
  >);
  vi.mocked(useQueues).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useQueues>);
  vi.mocked(useAdmins).mockReturnValue({ admins: [], isLoading: false } as unknown as ReturnType<typeof useAdmins>);
  vi.mocked(useStaffList).mockReturnValue({ data: { data: [] }, isLoading: false } as unknown as ReturnType<
    typeof useStaffList
  >);
  vi.mocked(useSetRecommendedJourney).mockReturnValue({ mutate: saveOrder, isPending: false } as unknown as ReturnType<
    typeof useSetRecommendedJourney
  >);
});

const journey = (current: number, total: number) => ({
  currentStepNumber: current,
  totalSteps: total,
  referredTo: null,
  steps: Array.from({ length: total }, (_, i) => ({
    stepNumber: i + 1,
    serviceId: `s${i + 1}`,
    serviceName: ['Registration', 'Payment', 'Pharmacy'][i]!,
    status: i + 1 < current ? 'COMPLETED' : i + 1 === current ? 'IN_PROGRESS' : 'PENDING',
  })),
});

describe('completing a journey step (ADR-070)', () => {
  it('says "Complete step" and offers Refer while more steps follow; no end-of-visit feedback yet', async () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" counterId="c1" journey={journey(1, 2)} />);
    expect(screen.getByRole('button', { name: 'Refer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Feedback' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Complete step' }));
    expect(completeMutate).toHaveBeenCalledWith({ tokenId: 't1' }, expect.anything());
  });

  it('on the last step it is the ordinary Complete, with Feedback and no Refer', () => {
    render(<TokenActions tokenId="t1" queueId="q1" status="IN_PROGRESS" counterId="c1" journey={journey(2, 2)} />);
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refer' })).not.toBeInTheDocument();
  });
});

describe('ReferralDialog (ADR-070)', () => {
  it('refers the next step to a chosen counter with an optional note', async () => {
    vi.mocked(getReferralOptions).mockResolvedValue({
      success: true,
      data: {
        nextStep: { stepNumber: 2, serviceId: 's2', serviceName: 'Payment' },
        currentCounterHandlesNext: false,
        targets: [
          { id: 'pay1', name: 'Pay 1', busy: true },
          { id: 'pay2', name: 'Pay 2', busy: false },
        ],
      },
    } as never);
    wrap(<ReferralDialog tokenId="t1" onClose={() => undefined} />);
    expect(await screen.findByText('Payment')).toBeInTheDocument();
    expect(screen.getByText('serving someone now')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Complete and refer' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/Pay 2/));
    await userEvent.type(screen.getByLabelText(/Note for the next counter/), 'Fee due');
    await userEvent.click(submit);
    expect(completeMutate).toHaveBeenCalledWith(
      { tokenId: 't1', referral: { referToCounterId: 'pay2', referralNote: 'Fee due' } },
      expect.anything(),
    );
  });

  it('explains that no referral is needed when this counter handles the next step', async () => {
    vi.mocked(getReferralOptions).mockResolvedValue({
      success: true,
      data: { nextStep: { stepNumber: 2, serviceId: 's2', serviceName: 'Payment' }, currentCounterHandlesNext: true, targets: [] },
    } as never);
    wrap(<ReferralDialog tokenId="t1" onClose={() => undefined} />);
    expect(await screen.findByText(/no referral is needed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Complete and refer' })).not.toBeInTheDocument();
  });

  it('says when no open counter handles the next step', async () => {
    vi.mocked(getReferralOptions).mockResolvedValue({
      success: true,
      data: { nextStep: { stepNumber: 2, serviceId: 's2', serviceName: 'Payment' }, currentCounterHandlesNext: false, targets: [] },
    } as never);
    wrap(<ReferralDialog tokenId="t1" onClose={() => undefined} />);
    expect(await screen.findByText(/No open counter handles Payment right now/)).toBeInTheDocument();
  });
});

describe('Create Queue — first counter (ADR-069)', () => {
  it('an Admin: name, then the first counter operated by themselves by default', async () => {
    createQueue.mockResolvedValue({ data: { id: 'q9' } });
    wrap(<CreateQueueModal onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Queue name'), 'Pharmacy');
    expect(screen.getByLabelText('Counter name')).toHaveValue('Counter 1');
    expect(screen.getByRole('radio', { name: 'Assign myself' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(createQueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pharmacy', tokenPrefix: 'P', firstCounter: { name: 'Counter 1' } }),
    );
    expect(createQueue.mock.calls[0]![0]).not.toHaveProperty('adminId');
  });

  it('with no Executives, says so and offers Invite Executive or Assign Myself', async () => {
    wrap(<CreateQueueModal onClose={() => undefined} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Assign an Executive' }));
    expect(
      screen.getByText('No Executives available. Add an Executive first, or assign yourself to this counter.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite Executive' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assign Myself' }));
    expect(screen.getByRole('radio', { name: 'Assign myself' })).toBeChecked();
  });

  it('sends the chosen Executive as the first counter’s operator', async () => {
    vi.mocked(useStaffList).mockReturnValue({
      data: { data: [{ id: 'e1', name: 'Eve', role: 'STAFF', status: 'ACTIVE', workspaceAdminId: 'admin1' }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useStaffList>);
    createQueue.mockResolvedValue({ data: { id: 'q9' } });
    wrap(<CreateQueueModal onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Queue name'), 'Lab');
    await userEvent.click(screen.getByRole('radio', { name: 'Assign an Executive' }));
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Executive'), 'e1');
    await userEvent.click(create);
    expect(createQueue).toHaveBeenCalledWith(
      expect.objectContaining({ firstCounter: { name: 'Counter 1', operatorStaffId: 'e1' } }),
    );
  });

  it('the Organization Head must name the Admin (only Admins without a queue are offered)', async () => {
    permissions = [...permissions, 'manage_admins', 'view_all_workspaces'];
    me = { id: 'head', role: 'OWNER' };
    vi.mocked(useAdmins).mockReturnValue({
      admins: [
        { id: 'a1', name: 'Ada', role: 'ADMIN', status: 'ACTIVE' },
        { id: 'a2', name: 'Bo', role: 'ADMIN', status: 'ACTIVE' },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useAdmins>);
    vi.mocked(useQueues).mockReturnValue({ data: [{ id: 'q1', adminId: 'a2' }] } as unknown as ReturnType<
      typeof useQueues
    >);
    createQueue.mockResolvedValue({ data: { id: 'q9' } });
    wrap(<CreateQueueModal onClose={() => undefined} />);
    const admin = screen.getByLabelText('Admin');
    expect(within(admin).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose the Admin whose queue this is…',
      'Ada',
    ]);
    await userEvent.type(screen.getByLabelText('Queue name'), 'Billing');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    await userEvent.selectOptions(admin, 'a1');
    expect(screen.getByRole('radio', { name: 'Assign the Admin' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(createQueue).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1', name: 'Billing' }));
  });

  it('the Head with no free Admin is told to invite one first', () => {
    permissions = [...permissions, 'manage_admins'];
    me = { id: 'head', role: 'OWNER' };
    wrap(<CreateQueueModal onClose={() => undefined} />);
    expect(screen.getByText(/Invite an Admin first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite Admin' })).toBeInTheDocument();
  });
});

describe('Recommended order editor (ADR-070)', () => {
  const services = [
    { id: 'reg', serviceName: 'Registration', isActive: true, maxOccurrencesPerJourney: 1 },
    { id: 'pay', serviceName: 'Payment', isActive: true, maxOccurrencesPerJourney: 2 },
  ] as never;

  it('saves the arranged order', async () => {
    vi.mocked(useRecommendedJourney).mockReturnValue({
      data: { serviceIds: ['pay', 'reg'], unroutableServiceIds: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useRecommendedJourney>);
    wrap(<RecommendedJourneyEditor queueId="q1" services={services} editable />);
    const save = screen.getByRole('button', { name: 'Save order' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Registration up' }));
    await userEvent.click(save);
    expect(saveOrder).toHaveBeenCalledWith(['reg', 'pay'], expect.anything());
  });

  it('is read-only for someone who may not manage the queue', () => {
    vi.mocked(useRecommendedJourney).mockReturnValue({
      data: { serviceIds: ['reg', 'pay'], unroutableServiceIds: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useRecommendedJourney>);
    wrap(<RecommendedJourneyEditor queueId="q1" services={services} editable={false} />);
    expect(screen.getByText('Registration')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('warns when a step has no staffed counter that handles it', () => {
    vi.mocked(useRecommendedJourney).mockReturnValue({
      data: { serviceIds: ['reg', 'pay'], unroutableServiceIds: ['pay'] },
      isLoading: false,
    } as unknown as ReturnType<typeof useRecommendedJourney>);
    wrap(<RecommendedJourneyEditor queueId="q1" services={services} editable />);
    expect(screen.getByText(/No staffed counter handles Payment right now/)).toBeInTheDocument();
  });
});

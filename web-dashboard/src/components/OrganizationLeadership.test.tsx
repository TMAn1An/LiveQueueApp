import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationLeadership } from './OrganizationLeadership';
import * as api from '../api/leadership.api';
import type { Leadership, Succession } from '../api/leadership.api';

vi.mock('../api/leadership.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/leadership.api')>();
  return {
    ...actual,
    getLeadership: vi.fn(),
    startSuccession: vi.fn(),
    verifySuccession: vi.fn(),
    resendSuccessorLink: vi.fn(),
    cancelSuccession: vi.fn(),
  };
});

function renderCard(isHead: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OrganizationLeadership isHead={isHead} />
    </QueryClientProvider>,
  );
}

function succession(overrides: Partial<Succession> = {}): Succession {
  return {
    id: 'hs1',
    status: 'AWAITING_VERIFICATION',
    successor: { name: 'Nadia Next', email: 'nadia@example.com', existingMember: false },
    reason: 'RETIREMENT',
    note: null,
    initiatedBy: { id: 'h1', name: 'Hana Head' },
    verificationExpiresAt: '2026-10-08T10:10:00.000Z',
    attemptsLeft: 5,
    successorLinkExpiresAt: null,
    verifiedAt: null,
    acceptedAt: null,
    declinedAt: null,
    cancelledAt: null,
    expiredAt: null,
    createdAt: '2026-10-08T10:00:00.000Z',
    ...overrides,
  };
}

const HISTORY: Leadership = {
  current: { name: 'Hana Head', since: '2026-10-07T00:00:00.000Z' },
  previous: [
    {
      name: 'Founding Fahim',
      startedAt: '2025-01-15T00:00:00.000Z',
      endedAt: '2026-10-07T00:00:00.000Z',
      startType: 'FOUNDING',
      reason: 'PERSONAL_REASONS',
      note: 'Family matter',
    },
  ],
  succession: null,
};

beforeEach(() => {
  vi.mocked(api.getLeadership).mockReset();
});

describe('Organization leadership (ADR-071)', () => {
  it('the Head sees the current Head, every previous Head with reason and private note, and no edit controls', async () => {
    vi.mocked(api.getLeadership).mockResolvedValue({ data: HISTORY });
    renderCard(true);
    expect(await screen.findByText('Hana Head')).toBeInTheDocument();
    expect(screen.getByText(/^Since /)).toBeInTheDocument();
    expect(screen.getByText('Founding Fahim')).toBeInTheDocument();
    expect(screen.getByText(/Personal reasons/)).toBeInTheDocument();
    expect(screen.getByText('Note: Family matter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transfer organization leadership' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit|delete/i })).not.toBeInTheDocument();
  });

  it('a Manager sees history and reasons, but no notes and no transfer', async () => {
    const managerView: Leadership = {
      ...HISTORY,
      previous: HISTORY.previous!.map(({ note: _n, ...rest }) => (void _n, rest)),
    };
    vi.mocked(api.getLeadership).mockResolvedValue({ data: managerView });
    renderCard(false);
    expect(await screen.findByText('Founding Fahim')).toBeInTheDocument();
    expect(screen.getByText(/Personal reasons/)).toBeInTheDocument();
    expect(screen.queryByText(/Family matter/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transfer organization leadership' })).not.toBeInTheDocument();
  });

  it('Admins and Executives see only the current Head', async () => {
    vi.mocked(api.getLeadership).mockResolvedValue({
      data: { current: HISTORY.current, previous: null, succession: null },
    });
    renderCard(false);
    expect(await screen.findByText('Hana Head')).toBeInTheDocument();
    expect(screen.queryByText('Previous Heads')).not.toBeInTheDocument();
    expect(screen.queryByText('Founding Fahim')).not.toBeInTheDocument();
  });

  it.each([
    ['AWAITING_VERIFICATION', 'Awaiting verification'],
    ['AWAITING_ACCEPTANCE', 'Awaiting successor acceptance'],
    ['EXPIRED', 'Expired'],
    ['CANCELLED', 'Cancelled'],
    ['DECLINED', 'Declined'],
    ['COMPLETED', 'Completed'],
  ] as const)('shows the %s state clearly', async (status, label) => {
    vi.mocked(api.getLeadership).mockResolvedValue({ data: { ...HISTORY, succession: succession({ status }) } });
    renderCard(true);
    const card = await screen.findByLabelText('Leadership handover status');
    expect(within(card).getByText(label)).toBeInTheDocument();
    const open = status === 'AWAITING_VERIFICATION' || status === 'AWAITING_ACCEPTANCE';
    expect(within(card).queryByRole('button', { name: 'Cancel handover' }) !== null).toBe(open);
    // A new handover can start only once nothing is open.
    expect(screen.queryByRole('button', { name: 'Transfer organization leadership' }) !== null).toBe(!open);
  });

  it('awaiting verification: the Head enters the emailed code', async () => {
    vi.mocked(api.getLeadership).mockResolvedValue({ data: { ...HISTORY, succession: succession() } });
    vi.mocked(api.verifySuccession).mockResolvedValue({
      data: { ...succession({ status: 'AWAITING_ACCEPTANCE' }), successorEmailSent: true },
    });
    renderCard(true);
    const input = await screen.findByLabelText('Enter the 6-digit code we emailed you');
    await userEvent.type(input, '12a34 56');
    expect(input).toHaveValue('123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(api.verifySuccession).toHaveBeenCalledWith('hs1', '123456');
    expect(await screen.findByText(/emailed Nadia Next a link to accept/)).toBeInTheDocument();
  });

  it('the wizard collects successor, reason and password; Other needs a description', async () => {
    vi.mocked(api.getLeadership).mockResolvedValue({ data: HISTORY });
    vi.mocked(api.startSuccession).mockResolvedValue({ data: { ...succession(), codeEmailSent: true } });
    renderCard(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Transfer organization leadership' }));
    const dialog = screen.getByRole('dialog', { name: 'Transfer organization leadership' });
    const next = () => within(dialog).getByRole('button', { name: 'Next' });
    expect(next()).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Successor's email"), 'nadia@example.com');
    await userEvent.type(within(dialog).getByLabelText(/Successor's name/), 'Nadia Next');
    await userEvent.click(next());

    await userEvent.selectOptions(within(dialog).getByLabelText('Reason for the handover'), 'OTHER');
    expect(next()).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Describe the reason'), 'Board decision this year');
    await userEvent.click(next());

    expect(within(dialog).getByText(/your account for this organization is closed/)).toBeInTheDocument();
    const send = within(dialog).getByRole('button', { name: 'Send verification code' });
    expect(send).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Your current password'), 'Password123');
    await userEvent.click(send);
    expect(api.startSuccession).toHaveBeenCalledWith({
      successorEmail: 'nadia@example.com',
      successorName: 'Nadia Next',
      reason: 'OTHER',
      note: 'Board decision this year',
      currentPassword: 'Password123',
    });
  });
});

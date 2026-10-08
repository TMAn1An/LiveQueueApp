import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { StaffPage } from './StaffPage';
import {
  useCancelRemovalRequest,
  useCreateRemovalRequest,
  useCreateStaff,
  useDeleteStaff,
  useRemovalRequests,
  useResendInvitation,
  useReviewRemovalRequest,
  useStaffList,
  useUpdateStaff,
  useAdmins,
  useRoleChangeImpact,
  useTransferWorkspace,
  useSetExecutiveWorkspace,
} from '../hooks/useStaff';
import type { MembershipRemovalRequest, Staff, StaffRole } from '../types/auth';

// ADR-057: what a row offers depends on who is looking. Each test sets the
// signed-in actor; the default is the owner.
const actor = vi.hoisted(() => ({ current: { id: 'owner1', role: 'OWNER' as string } }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true, staff: actor.current }),
}));
vi.mock('../hooks/useStaff');
vi.mock('../hooks/useDebouncedValue', () => ({ useDebouncedValue: (value: string) => value }));

const createMutateAsync = vi.fn();
const resendMutateAsync = vi.fn();

function staff(overrides: Partial<Staff> = {}): Staff {
  return {
    id: 's1',
    organizationId: 'org1',
    name: 'Rafi Ahmed',
    email: 'rafi@example.com',
    role: 'STAFF',
    status: 'ACTIVE',
    lastLoginAt: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

function mockList(rows: Staff[]) {
  vi.mocked(useStaffList).mockReturnValue({
    data: { data: rows, pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 } },
    isLoading: false,
    isFetching: false,
  } as unknown as ReturnType<typeof useStaffList>);
}

const reviewMutateAsync = vi.fn();
const createRequestMutateAsync = vi.fn();

function mockRequests(rows: MembershipRemovalRequest[]) {
  vi.mocked(useRemovalRequests).mockReturnValue({
    data: rows,
  } as unknown as ReturnType<typeof useRemovalRequests>);
}

function setActor(id: string, role: StaffRole) {
  actor.current = { id, role };
}

beforeEach(() => {
  vi.mocked(useAdmins).mockReturnValue({ admins: [] } as unknown as ReturnType<typeof useAdmins>);
  vi.mocked(useSetExecutiveWorkspace).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useSetExecutiveWorkspace>);
  vi.clearAllMocks();
  setActor('owner1', 'OWNER');
  mockRequests([]);
  reviewMutateAsync.mockResolvedValue({});
  createRequestMutateAsync.mockResolvedValue({});
  vi.mocked(useReviewRemovalRequest).mockReturnValue({
    mutateAsync: reviewMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useReviewRemovalRequest>);
  vi.mocked(useCreateRemovalRequest).mockReturnValue({
    mutateAsync: createRequestMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateRemovalRequest>);
  vi.mocked(useCancelRemovalRequest).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCancelRemovalRequest>);
  createMutateAsync.mockResolvedValue({ data: { id: 's2', invitationEmailSent: true } });
  resendMutateAsync.mockResolvedValue({ data: { emailSent: true } });
  vi.mocked(useCreateStaff).mockReturnValue({
    mutateAsync: createMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateStaff>);
  vi.mocked(useResendInvitation).mockReturnValue({
    mutateAsync: resendMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useResendInvitation>);
  vi.mocked(useUpdateStaff).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateStaff>);
  vi.mocked(useDeleteStaff).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteStaff>);
  mockList([staff()]);
});

describe('StaffPage — invitations', () => {
  it('invites without asking an administrator for a password', async () => {
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /^invite associate$/i }));

    // The password field is gone entirely; the colleague sets their own.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/link to set their own password/i)).toBeInTheDocument();
  });

  it('reports that the invitation was sent', async () => {
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /^invite associate$/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'Rafi Ahmed');
    await userEvent.type(screen.getByLabelText('Email'), 'rafi@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }));

    expect(createMutateAsync).toHaveBeenCalledWith({
      name: 'Rafi Ahmed',
      email: 'rafi@example.com',
      role: 'ADMIN',
    });
    expect(await screen.findByText(/Invitation email sent to Rafi Ahmed/i)).toBeInTheDocument();
  });

  it('says the account exists when the email could not be delivered', async () => {
    createMutateAsync.mockResolvedValue({ data: { id: 's2', invitationEmailSent: false } });
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /^invite associate$/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'Rafi Ahmed');
    await userEvent.type(screen.getByLabelText('Email'), 'rafi@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }));

    const notice = await screen.findByText(/invitation email could not be sent/i);
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toMatch(/Resend invite/i);
  });

  it('offers Resend invite only while an invitation is outstanding', () => {
    mockList([staff({ invitationPending: true, status: 'PENDING_EMAIL_VERIFICATION' })]);
    const { unmount } = render(<MemoryRouter><StaffPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /resend invite/i })).toBeInTheDocument();
    expect(screen.getByText(/invitation pending/i)).toBeInTheDocument();
    unmount();

    mockList([staff({ invitationPending: false })]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /resend invite/i })).not.toBeInTheDocument();
  });

  it('confirms a resend, and reports one that failed', async () => {
    mockList([staff({ invitationPending: true, status: 'PENDING_EMAIL_VERIFICATION' })]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: /resend invite/i }));
    expect(resendMutateAsync).toHaveBeenCalledWith('s1');
    expect(await screen.findByText('Invitation sent.')).toBeInTheDocument();

    resendMutateAsync.mockResolvedValue({ data: { emailSent: false } });
    await userEvent.click(screen.getByRole('button', { name: /resend invite/i }));
    expect(await screen.findByText('Could not send the email.')).toBeInTheDocument();
  });
});

// V2 Product Completion checkpoint, Part B: removing a staff member must
// ask first, through the shared ConfirmDialog rather than the page's own
// ad-hoc inline "Confirm"/"Cancel" it used to show. ADR-057 renamed the
// action Remove.
describe('StaffPage — remove confirmation', () => {
  it('does not call the delete mutation until Remove is clicked and confirmed', async () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteStaff).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteStaff>);
    mockList([staff({ id: 's1', name: 'Jane Doe', role: 'STAFF' })]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByText('Remove Jane Doe?')).toBeInTheDocument();
    expect(screen.getByText(/signed out on every device/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Remove Jane Doe?')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('calls the existing delete mutation once removal is confirmed', async () => {
    const mutate = vi.fn();
    vi.mocked(useDeleteStaff).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteStaff>);
    mockList([staff({ id: 's1', name: 'Jane Doe', role: 'STAFF' })]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await userEvent.click(removeButtons[removeButtons.length - 1]);

    expect(mutate).toHaveBeenCalledWith('s1', expect.anything());
  });
});

function member(id: string, role: StaffRole, name = `${role} ${id}`): Staff {
  return staff({ id, role, name, email: `${id}@example.com` });
}

const buttonsIn = (name: string) =>
  screen
    .getByText(name)
    .closest('tr')!
    .querySelectorAll('button');
const labels = (name: string) => Array.from(buttonsIn(name)).map((b) => b.textContent?.trim());

describe('StaffPage — ADR-057 role-aware membership actions', () => {
  const rows = [
    member('owner1', 'OWNER', 'Olivia Owner'),
    member('admin1', 'ADMIN', 'Adam Admin'),
    member('admin2', 'ADMIN', 'Aisha Admin'),
    member('staff1', 'STAFF', 'Sami Staff'),
  ];

  it('owner: Remove on admins and staff, never on themselves', () => {
    mockList(rows);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    expect(labels('Olivia Owner')).not.toContain('Remove');
    expect(labels('Olivia Owner')).not.toContain('Request to leave');
    expect(labels('Adam Admin')).toContain('Remove');
    expect(labels('Sami Staff')).toContain('Remove');
  });

  it('admin: Remove on staff, Request removal on another admin, Request to leave on self', () => {
    setActor('admin1', 'ADMIN');
    mockList(rows);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    expect(labels('Sami Staff')).toContain('Remove');
    expect(labels('Aisha Admin')).toEqual(expect.arrayContaining(['Request removal']));
    expect(labels('Aisha Admin')).not.toContain('Remove');
    expect(labels('Adam Admin')).toEqual(['Request to leave']);
    expect(labels('Olivia Owner')).toEqual([]);
  });

  it('admin: a removal request says the owner must approve, and sends the target id', async () => {
    setActor('admin1', 'ADMIN');
    mockList(rows);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    const requestButton = Array.from(buttonsIn('Aisha Admin')).find(
      (b) => b.textContent === 'Request removal',
    )!;
    await userEvent.click(requestButton);
    expect(screen.getByText(/Nothing changes until the owner approves/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send to owner' }));
    expect(createRequestMutateAsync).toHaveBeenCalledWith({ targetStaffId: 'admin2', reason: undefined });
  });

  it('owner: pending requests can be rejected, or approved after confirming', async () => {
    mockList(rows);
    mockRequests([
      {
        id: 'r1',
        requestType: 'SELF_LEAVE',
        status: 'PENDING',
        reason: 'Moving city',
        requester: { id: 'staff1', name: 'Sami Staff', email: 'staff1@example.com' },
        target: { id: 'staff1', name: 'Sami Staff', email: 'staff1@example.com', role: 'STAFF' },
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: null,
        createdAt: '2026-10-02T00:00:00.000Z',
      },
    ]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    expect(screen.getByText('Pending requests (1)')).toBeInTheDocument();
    expect(screen.getByText('Sami Staff (Executive) asks to leave.')).toBeInTheDocument();
    expect(screen.getByText('Removal requested')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(reviewMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/signs them out on every device/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve and remove' }));
    expect(reviewMutateAsync).toHaveBeenCalledWith({ requestId: 'r1', decision: 'approve' });

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(reviewMutateAsync).toHaveBeenCalledWith({ requestId: 'r1', decision: 'reject' });
  });
});

describe('StaffPage — ADR-056 Latin-only names', () => {
  it('flags a non-Latin name as it is typed and blocks sending', async () => {
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /^invite associate$/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'রহিম');
    await userEvent.type(screen.getByLabelText('Email'), 'r@example.com');
    expect(screen.getByRole('alert')).toHaveTextContent(/English letters/i);
    expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
  });
});

describe('StaffPage — ADR-061 suspension follows the removal rules', () => {
  const rows = [
    member('owner1', 'OWNER', 'Olivia Owner'),
    member('admin1', 'ADMIN', 'Adam Admin'),
    member('admin2', 'ADMIN', 'Aisha Admin'),
    member('staff1', 'STAFF', 'Sami Staff'),
  ];

  it('owner: Suspend on admins and staff, never on themselves', () => {
    mockList(rows);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    expect(labels('Adam Admin')).toContain('Suspend');
    expect(labels('Sami Staff')).toContain('Suspend');
    expect(labels('Olivia Owner')).not.toContain('Suspend');
  });

  it('admin: Suspend on staff only — never on another admin, the owner or themselves', () => {
    setActor('admin1', 'ADMIN');
    mockList(rows);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    expect(labels('Sami Staff')).toContain('Suspend');
    expect(labels('Aisha Admin')).not.toContain('Suspend');
    expect(labels('Aisha Admin')).toContain('Request removal');
    expect(labels('Olivia Owner')).not.toContain('Suspend');
    expect(labels('Adam Admin')).not.toContain('Suspend');
  });

  it('suspending asks for confirmation first; reactivating does not', async () => {
    const mutate = vi.fn();
    vi.mocked(useUpdateStaff).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<
      typeof useUpdateStaff
    >);
    mockList([member('staff1', 'STAFF', 'Sami Staff'), { ...member('staff2', 'STAFF', 'Suki Staff'), status: 'SUSPENDED' }]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);

    const suspend = Array.from(buttonsIn('Sami Staff')).find((b) => b.textContent === 'Suspend')!;
    await userEvent.click(suspend);
    expect(screen.getByText('Suspend Sami Staff?')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    const confirmButtons = screen.getAllByRole('button', { name: 'Suspend' });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]!);
    expect(mutate).toHaveBeenCalledWith({ staffId: 'staff1', input: { status: 'SUSPENDED' } }, expect.anything());

    const reactivate = Array.from(buttonsIn('Suki Staff')).find((b) => b.textContent === 'Reactivate')!;
    await userEvent.click(reactivate);
    expect(mutate).toHaveBeenLastCalledWith({ staffId: 'staff2', input: { status: 'ACTIVE' } }, expect.anything());
  });
});

// ADR-069 (D4): only the Organization Head invites or appoints Admins and
// Managers; an Admin invites Executives into their own workspace; a Manager
// invites no one.
describe('StaffPage — who may invite whom (ADR-069)', () => {
  it('the Organization Head may invite an Admin, an Executive or an Organization Manager', async () => {
    setActor('owner1', 'OWNER');
    mockList([]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /^invite associate$/i }));
    const options = within(screen.getByLabelText('Role')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Admin', 'Executive', 'Organization Manager']);
  });

  it('the Head must choose an Admin workspace for a new Executive — there is no organization-level option (ADR-071)', async () => {
    setActor('owner1', 'OWNER');
    mockList([]);
    vi.mocked(useAdmins).mockReturnValue({
      admins: [member('a1', 'ADMIN', 'Ada Admin')],
    } as unknown as ReturnType<typeof useAdmins>);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /^invite associate$/i }));
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'STAFF');
    await userEvent.type(screen.getByLabelText('Name'), 'New Exec');
    await userEvent.type(screen.getByLabelText('Email'), 'exec@example.com');
    const workspace = screen.getByLabelText('Admin workspace');
    expect(within(workspace).queryByText(/Organization-level/)).not.toBeInTheDocument();
    const send = screen.getByRole('button', { name: /send invitation/i });
    expect(send).toBeDisabled();
    await userEvent.selectOptions(workspace, 'a1');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ role: 'STAFF', workspaceAdminId: 'a1' }));
  });

  it('an Admin may only invite Executives', async () => {
    setActor('admin1', 'ADMIN');
    mockList([]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /^invite executive$/i }));
    expect(within(screen.getByLabelText('Role')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Executive']);
  });

  it('an Organization Manager sees the people, with role labels, but may invite and change no one', () => {
    setActor('manager1', 'MANAGER');
    mockList([member('a1', 'ADMIN', 'Ada Admin'), member('s1', 'STAFF', 'Sami Exec')]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
    expect(screen.getByText('Executive')).toBeInTheDocument();
    for (const name of ['Remove', 'Suspend', 'Request removal']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/Change .*role/)).not.toBeInTheDocument();
  });

  it('only the Head is offered role changes', () => {
    setActor('owner1', 'OWNER');
    mockList([member('s1', 'STAFF', 'Sami Exec')]);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    expect(screen.getByLabelText("Change Sami Exec's role")).toBeInTheDocument();
  });
});

// ADR-071: an Admin who still runs a queue, or has Executives, leaves the
// role only through a guided workspace handover.
describe('StaffPage — Admin replacement (ADR-071)', () => {
  const transferMutateAsync = vi.fn();
  const updateMutate = vi.fn();

  function impact(overrides: Record<string, unknown> = {}) {
    return {
      staff: { id: 'a1', name: 'Ada Admin', role: 'ADMIN' },
      liveQueue: { id: 'q1', name: 'Pharmacy' },
      executiveCount: 2,
      holdsCounter: true,
      activeService: false,
      requiresReplacement: true,
      eligibleReplacements: [
        { id: 'm1', name: 'Mira Manager', email: 'm1@example.com', role: 'MANAGER', workspaceAdminId: null },
        { id: 'a2', name: 'Abe Admin', email: 'a2@example.com', role: 'ADMIN', workspaceAdminId: null },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    setActor('owner1', 'OWNER');
    mockList([member('a1', 'ADMIN', 'Ada Admin'), member('m2', 'MANAGER', 'Max Manager')]);
    vi.mocked(useAdmins).mockReturnValue({
      admins: [member('a1', 'ADMIN', 'Ada Admin'), member('a2', 'ADMIN', 'Abe Admin')],
    } as unknown as ReturnType<typeof useAdmins>);
    transferMutateAsync.mockResolvedValue({ data: {} });
    vi.mocked(useTransferWorkspace).mockReturnValue({
      mutateAsync: transferMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useTransferWorkspace>);
    vi.mocked(useUpdateStaff).mockReturnValue({
      mutate: updateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateStaff>);
    vi.mocked(useRoleChangeImpact).mockReturnValue({
      data: impact(),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useRoleChangeImpact>);
  });

  it('changing the role of an Admin who runs a queue opens the guided replacement, not a failure', async () => {
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.selectOptions(screen.getByLabelText("Change Ada Admin's role"), 'MANAGER');

    const dialog = await screen.findByRole('dialog', { name: 'Replace Ada Admin as Admin' });
    expect(
      within(dialog).getByText('Ada Admin currently manages Pharmacy. Choose a replacement Admin before changing this role.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /becomes an Organization Manager/ })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Invite replacement Admin' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Delete the queue instead' })).toHaveAttribute('href', '/queues/q1');

    const confirm = within(dialog).getByRole('button', { name: 'Hand over workspace' });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Replacement Admin'), 'm1');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Moving to head office');

    // The summary says exactly what moves and what does not.
    expect(within(dialog).getByText('Pharmacy moves to Mira Manager.')).toBeInTheDocument();
    expect(within(dialog).getByText(/2 Executives move to Mira Manager/)).toBeInTheDocument();
    expect(within(dialog).getByText('Mira Manager becomes an Admin.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('The queue, its counters, services, tokens and history stay exactly as they are.'),
    ).toBeInTheDocument();

    await userEvent.click(confirm);
    expect(transferMutateAsync).toHaveBeenCalledWith({
      adminId: 'a1',
      input: { replacementStaffId: 'm1', outcome: 'MANAGER', reason: 'Moving to head office' },
    });
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('removing such an Admin opens the same flow with "leaves the organization" chosen', async () => {
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    const row = screen.getByText('Ada Admin').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace Ada Admin as Admin' });
    expect(within(dialog).getByRole('radio', { name: /leaves the organization/ })).toBeChecked();
  });

  it('an Admin with no queue and no Executives changes role with a plain confirmation', async () => {
    vi.mocked(useRoleChangeImpact).mockReturnValue({
      data: impact({ liveQueue: null, executiveCount: 0, requiresReplacement: false, eligibleReplacements: [] }),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useRoleChangeImpact>);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.selectOptions(screen.getByLabelText("Change Ada Admin's role"), 'MANAGER');
    const dialog = await screen.findByRole('dialog', { name: 'Make Ada Admin Organization Manager?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change role' }));
    expect(updateMutate).toHaveBeenCalledWith(
      { staffId: 'a1', input: { role: 'MANAGER' } },
      expect.anything(),
    );
  });

  it('making someone an Executive asks which Admin’s workspace they join', async () => {
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.selectOptions(screen.getByLabelText("Change Max Manager's role"), 'STAFF');
    const dialog = await screen.findByRole('dialog', { name: 'Make Max Manager Executive?' });
    const change = within(dialog).getByRole('button', { name: 'Change role' });
    expect(change).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Admin workspace'), 'a2');
    await userEvent.click(change);
    expect(updateMutate).toHaveBeenCalledWith(
      { staffId: 'm2', input: { role: 'STAFF', workspaceAdminId: 'a2' } },
      expect.anything(),
    );
  });

  it('when nobody can take over yet, says so and offers to invite an Admin', async () => {
    vi.mocked(useRoleChangeImpact).mockReturnValue({
      data: impact({ eligibleReplacements: [] }),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useRoleChangeImpact>);
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.selectOptions(screen.getByLabelText("Change Ada Admin's role"), 'MANAGER');
    const dialog = await screen.findByRole('dialog', { name: 'Replace Ada Admin as Admin' });
    expect(within(dialog).getByText(/Nobody can take over yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Hand over workspace' })).toBeDisabled();
  });
});

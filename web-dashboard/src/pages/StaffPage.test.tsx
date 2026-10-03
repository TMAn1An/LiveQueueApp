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
    await userEvent.click(screen.getByRole('button', { name: /^invite member$/i }));

    // The password field is gone entirely; the colleague sets their own.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/link to set their own password/i)).toBeInTheDocument();
  });

  it('reports that the invitation was sent', async () => {
    render(<MemoryRouter><StaffPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /^invite member$/i }));
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
    await userEvent.click(screen.getByRole('button', { name: /^invite member$/i }));
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
    await userEvent.click(screen.getByRole('button', { name: /^invite member$/i }));
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
    await userEvent.click(screen.getByRole('button', { name: /^invite member$/i }));
    const options = within(screen.getByLabelText('Role')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Admin', 'Executive', 'Organization Manager']);
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

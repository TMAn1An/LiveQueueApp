import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffPage } from './StaffPage';
import {
  useCreateStaff,
  useDeleteStaff,
  useResendInvitation,
  useStaffList,
  useUpdateStaff,
} from '../hooks/useStaff';
import type { Staff } from '../types/auth';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
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

beforeEach(() => {
  vi.clearAllMocks();
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
    render(<StaffPage />);
    await userEvent.click(screen.getByRole('button', { name: /invite staff member/i }));

    // The password field is gone entirely; the colleague sets their own.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/link to set their own password/i)).toBeInTheDocument();
  });

  it('reports that the invitation was sent', async () => {
    render(<StaffPage />);
    await userEvent.click(screen.getByRole('button', { name: /invite staff member/i }));
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
    render(<StaffPage />);
    await userEvent.click(screen.getByRole('button', { name: /invite staff member/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'Rafi Ahmed');
    await userEvent.type(screen.getByLabelText('Email'), 'rafi@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send invitation/i }));

    const notice = await screen.findByText(/invitation email could not be sent/i);
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toMatch(/Resend invite/i);
  });

  it('offers Resend invite only while an invitation is outstanding', () => {
    mockList([staff({ invitationPending: true, status: 'PENDING_EMAIL_VERIFICATION' })]);
    const { unmount } = render(<StaffPage />);
    expect(screen.getByRole('button', { name: /resend invite/i })).toBeInTheDocument();
    expect(screen.getByText(/invitation pending/i)).toBeInTheDocument();
    unmount();

    mockList([staff({ invitationPending: false })]);
    render(<StaffPage />);
    expect(screen.queryByRole('button', { name: /resend invite/i })).not.toBeInTheDocument();
  });

  it('confirms a resend, and reports one that failed', async () => {
    mockList([staff({ invitationPending: true, status: 'PENDING_EMAIL_VERIFICATION' })]);
    render(<StaffPage />);

    await userEvent.click(screen.getByRole('button', { name: /resend invite/i }));
    expect(resendMutateAsync).toHaveBeenCalledWith('s1');
    expect(await screen.findByText('Invitation sent.')).toBeInTheDocument();

    resendMutateAsync.mockResolvedValue({ data: { emailSent: false } });
    await userEvent.click(screen.getByRole('button', { name: /resend invite/i }));
    expect(await screen.findByText('Could not send the email.')).toBeInTheDocument();
  });
});

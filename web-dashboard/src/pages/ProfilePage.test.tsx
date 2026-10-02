import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePage } from './ProfilePage';
import {
  useCancelRemovalRequest,
  useCreateRemovalRequest,
  useRemovalRequests,
} from '../hooks/useStaff';

const auth = vi.hoisted(() => ({ role: 'STAFF' as string }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    staff: { id: 's1', name: 'Sami', email: 's@example.com', role: auth.role, status: 'ACTIVE', lastLoginAt: null },
    organization: { id: 'o1', name: 'Acme' },
    permissions: [],
    logout: vi.fn(),
    changePassword: vi.fn(),
  }),
}));
vi.mock('../hooks/useStaff');

const createMutateAsync = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'STAFF';
  createMutateAsync.mockResolvedValue({});
  vi.mocked(useRemovalRequests).mockReturnValue({ data: [] } as unknown as ReturnType<typeof useRemovalRequests>);
  vi.mocked(useCreateRemovalRequest).mockReturnValue({
    mutateAsync: createMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateRemovalRequest>);
  vi.mocked(useCancelRemovalRequest).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCancelRemovalRequest>);
});

describe('ProfilePage — ADR-057 leaving the organization', () => {
  it('STAFF can only request to leave — the owner must approve', async () => {
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Request to leave' }));
    expect(screen.getByText(/You keep your access until the owner approves it/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Reason/), 'Moving city');
    await userEvent.click(screen.getByRole('button', { name: 'Send to owner' }));
    expect(createMutateAsync).toHaveBeenCalledWith({ targetStaffId: 's1', reason: 'Moving city' });
  });

  it('a pending leave request replaces the button and can be withdrawn', () => {
    vi.mocked(useRemovalRequests).mockReturnValue({
      data: [
        {
          id: 'r1',
          requestType: 'SELF_LEAVE',
          status: 'PENDING',
          reason: null,
          requester: { id: 's1', name: 'Sami', email: 's@example.com' },
          target: { id: 's1', name: 'Sami', email: 's@example.com', role: 'STAFF' },
          reviewedAt: null,
          reviewedBy: null,
          reviewNote: null,
          createdAt: '2026-10-02T00:00:00.000Z',
        },
      ],
    } as unknown as ReturnType<typeof useRemovalRequests>);
    render(<ProfilePage />);
    expect(screen.queryByRole('button', { name: 'Request to leave' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('the OWNER is told to delete the organization instead — there is no leave action', () => {
    auth.role = 'OWNER';
    render(<ProfilePage />);
    expect(screen.queryByRole('button', { name: 'Request to leave' })).not.toBeInTheDocument();
    expect(screen.getByText(/delete the organization in/i)).toBeInTheDocument();
  });
});

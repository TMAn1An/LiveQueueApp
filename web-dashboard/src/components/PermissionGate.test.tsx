import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionGate } from './PermissionGate';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

describe('PermissionGate', () => {
  it('renders children when the staff member has the required permission', () => {
    vi.mocked(useAuth).mockReturnValue({ hasPermission: () => true } as unknown as ReturnType<typeof useAuth>);

    render(
      <PermissionGate permission="manage_queues">
        <button>Delete Queue</button>
      </PermissionGate>,
    );

    expect(screen.getByText('Delete Queue')).toBeInTheDocument();
  });

  it('renders nothing when the staff member lacks the permission — UI hint only, not a security boundary', () => {
    vi.mocked(useAuth).mockReturnValue({ hasPermission: () => false } as unknown as ReturnType<typeof useAuth>);

    render(
      <PermissionGate permission="manage_queues">
        <button>Delete Queue</button>
      </PermissionGate>,
    );

    expect(screen.queryByText('Delete Queue')).not.toBeInTheDocument();
  });
});

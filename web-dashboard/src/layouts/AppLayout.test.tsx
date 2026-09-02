import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    staff: { id: 's1', name: 'Owner', email: 'owner@example.com', role: 'OWNER', status: 'ACTIVE' },
    organization: { id: 'org-1', name: 'Test Org' },
    hasPermission: () => true,
    logout: vi.fn(),
  }),
}));
vi.mock('../hooks/useOrganizationSocket', () => ({
  useOrganizationSocket: () => undefined,
}));

describe('AppLayout navigation', () => {
  it('labels the device section "Device Blocking" while keeping the /devices route', () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Device Blocking' });
    expect(link).toHaveAttribute('href', '/devices');
    expect(screen.queryByText('Blocked Devices')).not.toBeInTheDocument();
  });
});

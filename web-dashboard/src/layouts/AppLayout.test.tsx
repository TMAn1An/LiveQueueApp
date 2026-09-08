import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { ThemeProvider } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import type { StaffRole } from '../types/auth';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../hooks/useOrganizationSocket', () => ({
  useOrganizationSocket: () => undefined,
}));

/**
 * Every permission granted by default: the sidebar hides links by permission,
 * so the strongest evidence that something is gone is that the account most
 * entitled to see it still does not.
 */
function mockSession(role: StaffRole = 'OWNER', hasPermission: () => boolean = () => true) {
  vi.mocked(useAuth).mockReturnValue({
    staff: { id: 's1', name: 'Owner', email: 'owner@example.com', role, status: 'ACTIVE' },
    organization: { id: 'org-1', name: 'Test Org' },
    hasPermission,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

function renderLayout() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('AppLayout branding', () => {
  it('shows the LiveQueue logo in the sidebar above the organization name', () => {
    mockSession();
    renderLayout();

    expect(screen.getByAltText('LiveQueue')).toHaveAttribute('src', '/logo-horizontal.png');
    expect(screen.getByText('Test Org')).toBeInTheDocument();
  });
});

describe('AppLayout navigation', () => {
  it('still offers the sections that remain', () => {
    mockSession();
    renderLayout();

    for (const label of ['Dashboard', 'Queues', 'Staff', 'Reports', 'Organization Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  // Device Blocking is withdrawn from the dashboard: it blocks an
  // installation rather than a person, which sits badly beside the
  // verified-identity repeat rules. The backend keeps the capability.
  it.each<StaffRole>(['OWNER', 'ADMIN', 'STAFF'])(
    'offers no Device Blocking entry point to a %s, even holding every permission',
    (role) => {
      mockSession(role);
      renderLayout();

      expect(screen.queryByRole('link', { name: 'Device Blocking' })).not.toBeInTheDocument();
      expect(screen.queryByText('Device Blocking')).not.toBeInTheDocument();
      expect(screen.queryByText('Blocked Devices')).not.toBeInTheDocument();
      expect(
        screen.queryAllByRole('link').map((link) => link.getAttribute('href')),
      ).not.toContain('/devices');
    },
  );
});

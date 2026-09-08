import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import App from './App';
import { useAuth } from './context/AuthContext';

vi.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: vi.fn(),
}));
vi.mock('./hooks/useOrganizationSocket', () => ({
  useOrganizationSocket: () => undefined,
}));
// Landing pages are stubbed so this file tests routing and nothing else —
// neither page's data fetching is under examination here.
vi.mock('./pages/DashboardPage', () => ({
  DashboardPage: () => <div>Dashboard Page Content</div>,
}));
vi.mock('./pages/QueuesPage', () => ({
  QueuesPage: () => <div>Queues Page Content</div>,
}));

function signedIn() {
  vi.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    staff: { id: 's1', name: 'Owner', email: 'owner@example.com', role: 'OWNER', status: 'ACTIVE' },
    organization: { id: 'org-1', name: 'Test Org' },
    // Deliberately permissive: `manage_blocked_devices` included, so a pass
    // here means the route is gone rather than merely guarded.
    hasPermission: () => true,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

function visit(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  signedIn();
});

describe('App routing — Device Blocking withdrawal', () => {
  it('does not render the Device Blocking page for a signed-in owner typing /devices', async () => {
    visit('/devices');

    await waitFor(() =>
      expect(screen.getByText('Dashboard Page Content')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: 'Device Blocking' })).not.toBeInTheDocument();
    expect(screen.queryByText('Blocked Devices')).not.toBeInTheDocument();
  });

  it('treats /devices exactly like any other unknown path', async () => {
    visit('/devices');
    await waitFor(() =>
      expect(screen.getByText('Dashboard Page Content')).toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe('/dashboard');

    visit('/no-such-page');
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
  });

  it('still routes the pages that remain', async () => {
    visit('/queues');
    await waitFor(() => expect(screen.getByText('Queues Page Content')).toBeInTheDocument());
  });
});

describe('App routing — account setup branding', () => {
  it('renders the setup page with a single logo, inside the card', async () => {
    visit('/accept-invitation?token=abc');

    const heading = await screen.findByRole('heading', { name: 'Set up your account' });
    expect(screen.getAllByAltText('LiveQueue')).toHaveLength(1);
    expect(heading.parentElement).toContainElement(screen.getByAltText('LiveQueue'));
  });

  it('keeps the logo above the card on sign-in', async () => {
    visit('/login');

    const logo = await screen.findByAltText('LiveQueue');
    expect(screen.getAllByAltText('LiveQueue')).toHaveLength(1);
    expect(logo.closest('h1')).not.toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { ThemeProvider } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import type { Organization, StaffRole } from '../types/auth';

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
 *
 * `onboardingCompletedAt` defaults to already-completed — matching every
 * pre-checkpoint organization after its backfill migration — so the
 * onboarding-gating tests below are the only ones that need to override it.
 */
function mockSession(
  role: StaffRole = 'OWNER',
  hasPermission: () => boolean = () => true,
  organizationOverrides: Partial<Organization> = {},
) {
  vi.mocked(useAuth).mockReturnValue({
    staff: { id: 's1', name: 'Owner', email: 'owner@example.com', role, status: 'ACTIVE' },
    organization: {
      id: 'org-1',
      name: 'Test Org',
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      ...organizationOverrides,
    },
    hasPermission,
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

function renderLayout() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter>
          <AppLayout />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
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

    for (const label of ['Dashboard', 'Queues', 'Associates', 'Reports', 'Organization Settings']) {
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

// jsdom does no layout, so this pins the classes that produce the behaviour:
// on desktop the sidebar stays in view while a long page scrolls; on mobile
// it is still the off-canvas drawer it always was.
describe('AppLayout sidebar positioning', () => {
  it('is sticky to the viewport on desktop and a closed drawer on mobile', () => {
    mockSession();
    const { container } = renderLayout();

    const sidebar = container.querySelector('aside');
    expect(sidebar).not.toBeNull();
    const classes = sidebar!.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['lg:sticky', 'lg:top-0', 'lg:h-screen', 'lg:translate-x-0']));
    expect(classes).not.toContain('lg:static');
    // Mobile drawer, untouched: fixed, and off-screen until opened.
    expect(classes).toEqual(expect.arrayContaining(['fixed', 'inset-y-0', '-translate-x-full']));
  });

  it('opens as a drawer from the menu button on mobile', async () => {
    mockSession();
    const { container } = renderLayout();

    screen.getByRole('button', { name: 'Open navigation menu' }).click();

    await screen.findByRole('link', { name: 'Dashboard' });
    await vi.waitFor(() => {
      const classes = container.querySelector('aside')!.className.split(/\s+/);
      expect(classes).toContain('translate-x-0');
      expect(classes).not.toContain('-translate-x-full');
    });
  });
});

// V2 Product Completion checkpoint, Part C: the setup guide is the owner's
// own onboarding, not a permission-gated feature — it never appears for
// STAFF or ADMIN, no matter the organization's state, and never appears for
// an OWNER whose organization already finished it (every pre-checkpoint
// organization, via its backfill migration).
describe('AppLayout onboarding tutorial', () => {
  it('shows the guide to an eligible OWNER (onboardingCompletedAt is null)', () => {
    mockSession('OWNER', () => true, { onboardingCompletedAt: null });
    renderLayout();

    expect(screen.getByRole('region', { name: 'LiveQueue setup guide' })).toBeInTheDocument();
  });

  it('does not show the guide once the organization has completed it', () => {
    mockSession('OWNER', () => true, { onboardingCompletedAt: '2026-01-01T00:00:00.000Z' });
    renderLayout();

    expect(screen.queryByRole('region', { name: 'LiveQueue setup guide' })).not.toBeInTheDocument();
  });

  it.each<StaffRole>(['ADMIN', 'STAFF'])(
    'never shows the owner setup guide to a %s, even when onboarding is incomplete',
    (role) => {
      mockSession(role, () => true, { onboardingCompletedAt: null });
      renderLayout();

      expect(screen.queryByRole('region', { name: 'LiveQueue setup guide' })).not.toBeInTheDocument();
    },
  );
});

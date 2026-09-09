import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OrganizationSettingsPage } from './OrganizationSettingsPage';
import { useAuth } from '../context/AuthContext';
import {
  useDeleteOrganization,
  useOrganization,
  useRestartOnboarding,
  useUpdateOrganization,
} from '../hooks/useOrganization';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../hooks/useOrganization');

function mockRole(role: 'OWNER' | 'ADMIN' | 'STAFF') {
  vi.mocked(useAuth).mockReturnValue({
    staff: { id: 's1', name: 'Owner', role },
    logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OrganizationSettingsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useOrganization).mockReturnValue({
    data: { id: 'org-1', name: 'Acme Corp', timezone: null, onboardingCompletedAt: null },
    isLoading: false,
  } as unknown as ReturnType<typeof useOrganization>);
  vi.mocked(useUpdateOrganization).mockReturnValue({
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateOrganization>);
  vi.mocked(useDeleteOrganization).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteOrganization>);
  vi.mocked(useRestartOnboarding).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useRestartOnboarding>);
});

describe('OrganizationSettingsPage — Restart tutorial', () => {
  it('offers Restart tutorial to the owner', () => {
    mockRole('OWNER');
    renderPage();

    expect(screen.getByRole('button', { name: 'Restart tutorial' })).toBeInTheDocument();
  });

  it('calls the restart mutation and confirms it will reappear', async () => {
    const mutate = vi.fn((_arg, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
    vi.mocked(useRestartOnboarding).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useRestartOnboarding>);
    mockRole('OWNER');
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Restart tutorial' }));

    expect(mutate).toHaveBeenCalled();
    expect(screen.getByText(/will reappear the next time you load the dashboard/i)).toBeInTheDocument();
  });

  it('does not offer it to a non-owner', () => {
    mockRole('ADMIN');
    renderPage();

    expect(screen.queryByRole('button', { name: 'Restart tutorial' })).not.toBeInTheDocument();
  });
});

// A light regression check: this checkpoint added a card above Delete
// Organization, and its own special confirmation flow must render exactly
// as before.
describe('OrganizationSettingsPage — organization deletion is unaffected', () => {
  it('still requires typing the organization name to confirm', async () => {
    mockRole('OWNER');
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Delete Organization' }));

    expect(screen.getByText(/Type/)).toBeInTheDocument();
    expect(screen.getByText('Acme Corp', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Permanently Delete' })).toBeDisabled();
  });
});

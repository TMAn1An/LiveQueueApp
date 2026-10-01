import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegisterPage } from './RegisterPage';
import * as authApi from '../api/auth.api';

vi.mock('../api/auth.api');
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ register: vi.fn() }),
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RegisterPage — organization name availability', () => {
  it('shows a taken name as you type and blocks creating the organization', async () => {
    vi.mocked(authApi.checkOrganizationNameAvailability).mockResolvedValue({ data: { available: false } } as never);
    renderPage();

    await userEvent.type(screen.getByLabelText('Organization name'), 'Volvo');

    expect(await screen.findByText(/already taken/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeDisabled();
  });

  it('shows an available name, and checks it case-insensitively', async () => {
    vi.mocked(authApi.checkOrganizationNameAvailability).mockResolvedValue({ data: { available: true } } as never);
    renderPage();

    await userEvent.type(screen.getByLabelText('Organization name'), '  New   Clinic ');

    expect(await screen.findByText(/is available/i)).toBeInTheDocument();
    expect(authApi.checkOrganizationNameAvailability).toHaveBeenLastCalledWith('new clinic');
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
  });

  it('does not check a name too short to register', async () => {
    renderPage();

    await userEvent.type(screen.getByLabelText('Organization name'), 'A');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(authApi.checkOrganizationNameAvailability).not.toHaveBeenCalled();
  });
});

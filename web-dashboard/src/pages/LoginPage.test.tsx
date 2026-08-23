import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

describe('LoginPage', () => {
  it('submits email/password and navigates to /dashboard on success', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({ login } as unknown as ReturnType<typeof useAuth>);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'Password123');
    await user.click(screen.getByText('Sign in'));

    await waitFor(() => expect(login).toHaveBeenCalledWith('owner@example.com', 'Password123'));
  });

  it('shows the server error message when login fails with an ApiError', async () => {
    const login = vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'));
    vi.mocked(useAuth).mockReturnValue({ login } as unknown as ReturnType<typeof useAuth>);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByText('Sign in'));

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });
});

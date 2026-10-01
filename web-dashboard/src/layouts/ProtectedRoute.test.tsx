import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

type Status = 'loading' | 'authenticated' | 'unauthenticated' | 'reconnecting';

function renderWithRoute(status: Status, extra: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({ status, ...extra } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Dashboard Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('shows a loading state while the session is being restored', () => {
    renderWithRoute('loading');
    expect(screen.getByText('Loading session…')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
  });

  it('redirects to /login when unauthenticated', () => {
    renderWithRoute('unauthenticated');
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
  });

  it('renders the protected content when authenticated', () => {
    renderWithRoute('authenticated');
    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
  });

  describe('when the backend cannot be reached to confirm the session', () => {
    it('neither redirects to sign-in nor shows the protected screen', () => {
      renderWithRoute('reconnecting', { retrySessionRestore: vi.fn(), logout: vi.fn() });

      expect(screen.getByRole('heading', { name: 'Can’t reach LiveQueue' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/Reconnecting/);
      expect(screen.getByText(/You’re still signed in on this device/)).toBeInTheDocument();
      expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
      expect(screen.queryByText('Dashboard Content')).not.toBeInTheDocument();
    });

    it('offers an immediate retry', async () => {
      const retrySessionRestore = vi.fn();
      renderWithRoute('reconnecting', { retrySessionRestore, logout: vi.fn() });

      await userEvent.setup().click(screen.getByRole('button', { name: 'Retry now' }));

      expect(retrySessionRestore).toHaveBeenCalledTimes(1);
    });

    it('still lets the person sign out, so they are never stuck', async () => {
      const logout = vi.fn().mockResolvedValue(undefined);
      renderWithRoute('reconnecting', { retrySessionRestore: vi.fn(), logout });

      await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

      expect(logout).toHaveBeenCalledTimes(1);
    });
  });
});

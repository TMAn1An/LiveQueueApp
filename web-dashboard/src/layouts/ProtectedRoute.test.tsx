import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function renderWithRoute(status: 'loading' | 'authenticated' | 'unauthenticated') {
  vi.mocked(useAuth).mockReturnValue({ status } as unknown as ReturnType<typeof useAuth>);
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
});

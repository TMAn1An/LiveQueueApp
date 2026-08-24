import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PermissionRoute } from './PermissionRoute';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

function renderWithPermission(hasPermission: (permission: string) => boolean) {
  vi.mocked(useAuth).mockReturnValue({ hasPermission } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={['/staff']}>
      <Routes>
        <Route path="/dashboard" element={<div>Dashboard Content</div>} />
        <Route element={<PermissionRoute permission="manage_staff" />}>
          <Route path="/staff" element={<div>Staff Page Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('PermissionRoute', () => {
  it('redirects to /dashboard when the staff member lacks the required permission', () => {
    renderWithPermission(() => false);
    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
    expect(screen.queryByText('Staff Page Content')).not.toBeInTheDocument();
  });

  it('renders the protected page when the staff member holds the required permission', () => {
    renderWithPermission(() => true);
    expect(screen.getByText('Staff Page Content')).toBeInTheDocument();
  });
});

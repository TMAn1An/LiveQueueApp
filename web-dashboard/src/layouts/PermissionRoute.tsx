import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Permission } from '../types/auth';

/**
 * Route-level guard, not just nav-link hiding — a role lacking `permission`
 * is redirected away even on direct URL navigation. Still not the security
 * boundary (the backend independently enforces every permission); this only
 * prevents the dashboard from rendering a fully-interactive page the backend
 * will reject every action on.
 */
export function PermissionRoute({ permission }: { permission: Permission | Permission[] }) {
  const { hasPermission } = useAuth();
  // An array means any one of them is enough.
  const allowed = Array.isArray(permission) ? permission.some(hasPermission) : hasPermission(permission);
  if (!allowed) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

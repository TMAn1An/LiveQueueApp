import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import type { Permission } from '../types/auth';

/**
 * UI-only convenience — hides an action a staff member can't use. This is
 * never the security boundary; the backend enforces every permission
 * independently (CLAUDE.md section 3 / spec section 7.4).
 */
export function PermissionGate({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { hasPermission } = useAuth();
  if (!hasPermission(permission)) return null;
  return <>{children}</>;
}

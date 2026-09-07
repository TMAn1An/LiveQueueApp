import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOrganizationSocket } from '../hooks/useOrganizationSocket';
import { EmailVerificationBanner } from '../components/EmailVerificationBanner';
import { BrandLogo } from '../components/BrandLogo';
import { Button } from '../components/Button';
import { ThemeToggle } from '../components/ThemeToggle';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
    isActive
      ? 'bg-brand-600 text-white dark:bg-brand-500'
      : 'text-fg-soft hover:bg-subtle hover:text-fg'
  }`;

export function AppLayout() {
  const { staff, organization, hasPermission, logout } = useAuth();
  useOrganizationSocket(organization?.id ?? null);

  return (
    <div className="flex min-h-screen bg-page">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface p-4">
        <div className="mb-6">
          <BrandLogo className="mb-2 h-auto w-40" />
          <p className="truncate text-sm font-semibold text-fg">{organization?.name}</p>
        </div>
        <nav className="space-y-1">
          <NavLink to="/dashboard" className={navLinkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/queues" className={navLinkClass}>
            Queues
          </NavLink>
          {hasPermission('manage_staff') && (
            <NavLink to="/staff" className={navLinkClass}>
              Staff
            </NavLink>
          )}
          {hasPermission('manage_blocked_devices') && (
            <NavLink to="/devices" className={navLinkClass}>
              Device Blocking
            </NavLink>
          )}
          {hasPermission('view_reports') && (
            <NavLink to="/reports" className={navLinkClass}>
              Reports
            </NavLink>
          )}
          {hasPermission('view_reports') && (
            <NavLink to="/service-history" className={navLinkClass}>
              Service History
            </NavLink>
          )}
          {hasPermission('view_audit_logs') && (
            <NavLink to="/audit-logs" className={navLinkClass}>
              Audit Logs
            </NavLink>
          )}
          {hasPermission('manage_organization') && (
            <NavLink to="/organization" className={navLinkClass}>
              Organization Settings
            </NavLink>
          )}
          <NavLink to="/profile" className={navLinkClass}>
            Profile
          </NavLink>
        </nav>
        {/* Footer: reachable from every page, and out of the way of the
            page's own actions. */}
        <div className="mt-auto border-t border-border pt-3">
          <ThemeToggle />
        </div>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
          <span className="text-sm text-muted">
            {staff?.name} <span className="text-faint">· {staff?.role}</span>
          </span>
          {/* Ghost, not danger: signing out ends a session, it does not
              destroy anything, and red is reserved for what does. */}
          <Button variant="ghost" onClick={() => void logout()}>
            <LogoutIcon />
            Log out
          </Button>
        </header>
        <main className="p-6">
          {staff?.status === 'PENDING_EMAIL_VERIFICATION' && (
            <EmailVerificationBanner email={staff.email} />
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Inline SVG, matching the dashboard's existing no-icon-library approach. */
function LogoutIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

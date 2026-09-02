import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOrganizationSocket } from '../hooks/useOrganizationSocket';
import { EmailVerificationBanner } from '../components/EmailVerificationBanner';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
  }`;

export function AppLayout() {
  const { staff, organization, hasPermission, logout } = useAuth();
  useOrganizationSocket(organization?.id ?? null);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">LiveQueue</p>
          <p className="truncate text-sm font-semibold text-slate-900">{organization?.name}</p>
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
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <span className="text-sm text-slate-600">
            {staff?.name} <span className="text-slate-400">· {staff?.role}</span>
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            Log out
          </button>
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

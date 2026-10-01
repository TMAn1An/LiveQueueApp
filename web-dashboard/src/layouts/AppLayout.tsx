import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOrganizationSocket } from '../hooks/useOrganizationSocket';
import { EmailVerificationBanner } from '../components/EmailVerificationBanner';
import { BrandLogo } from '../components/BrandLogo';
import { Button } from '../components/Button';
import { OnboardingTutorial } from '../components/OnboardingTutorial';
import { ThemeToggle } from '../components/ThemeToggle';

interface NavItemProps {
  to: string;
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
  onNavigate?: () => void;
}

function NavItem({ to, label, icon: Icon, onNavigate }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-brand-600 text-white shadow-xs dark:bg-brand-500'
            : 'text-fg-soft hover:bg-subtle hover:text-fg'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={`h-4 w-4 shrink-0 transition-colors ${
              isActive
                ? 'text-white'
                : 'text-muted group-hover:text-fg'
            }`}
          />
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function AppLayout() {
  const { staff, organization, hasPermission, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  useOrganizationSocket(organization?.id ?? null);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const userInitial = staff?.name?.trim() ? staff.name.trim()[0].toUpperCase() : 'U';

  const navContent = (
    <div className="flex h-full flex-col">
      {/* Branding & Organization header */}
      <div className="border-b border-border p-4">
        <BrandLogo className="mb-3 h-auto w-36" />
        <div className="flex items-center justify-between rounded-lg bg-subtle p-2.5">
          <div className="min-w-0 flex-1 pr-2">
            <p className="truncate text-xs font-semibold text-fg">
              {organization?.name ?? 'Organization'}
            </p>
            <p className="text-[11px] text-muted">Digital Queue System</p>
          </div>
          {staff?.role && (
            <span className="inline-flex shrink-0 items-center rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-fg-soft border border-border">
              {staff.role}
            </span>
          )}
        </div>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div>
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider uppercase text-faint">
            Operations
          </p>
          <nav className="space-y-1">
            <NavItem
              to="/dashboard"
              label="Dashboard"
              icon={DashboardIcon}
              onNavigate={closeMobileMenu}
            />
            <NavItem
              to="/queues"
              label="Queues"
              icon={QueuesIcon}
              onNavigate={closeMobileMenu}
            />
            {hasPermission('manage_staff') && (
              <NavItem
                to="/staff"
                label="Staff"
                icon={StaffIcon}
                onNavigate={closeMobileMenu}
              />
            )}
          </nav>
        </div>

        {(hasPermission('view_reports') || hasPermission('view_audit_logs')) && (
          <div>
            <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider uppercase text-faint">
              Analytics & Logs
            </p>
            <nav className="space-y-1">
              {hasPermission('view_reports') && (
                <>
                  <NavItem
                    to="/reports"
                    label="Reports"
                    icon={ReportsIcon}
                    onNavigate={closeMobileMenu}
                  />
                  <NavItem
                    to="/service-history"
                    label="Service History"
                    icon={HistoryIcon}
                    onNavigate={closeMobileMenu}
                  />
                </>
              )}
              {hasPermission('view_audit_logs') && (
                <NavItem
                  to="/audit-logs"
                  label="Audit Logs"
                  icon={AuditIcon}
                  onNavigate={closeMobileMenu}
                />
              )}
            </nav>
          </div>
        )}

        <div>
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider uppercase text-faint">
            Settings
          </p>
          <nav className="space-y-1">
            {hasPermission('manage_organization') && (
              <NavItem
                to="/organization"
                label="Organization Settings"
                icon={OrgSettingsIcon}
                onNavigate={closeMobileMenu}
              />
            )}
            <NavItem
              to="/profile"
              label="Profile"
              icon={ProfileIcon}
              onNavigate={closeMobileMenu}
            />
          </nav>
        </div>
      </div>

      {/* Footer Controls & User Details */}
      <div className="border-t border-border p-3 space-y-3 bg-surface">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted">Theme</span>
          <ThemeToggle />
        </div>
        <div className="space-y-2 rounded-lg border border-border bg-subtle p-2">
          <div className="flex items-center gap-2 min-w-0 px-1">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
              {userInitial}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-fg">{staff?.name}</p>
              <p className="truncate text-[10px] text-muted">{staff?.email}</p>
            </div>
          </div>
          {/* A full-width, labelled target: the old icon-only button was a
              tiny hit area that only reacted right on top of the icon. */}
          <Button
            variant="ghost"
            className="w-full justify-start bg-surface hover:bg-surface"
            onClick={() => void logout()}
          >
            <LogoutIcon className="h-4 w-4" />
            Log out
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-page">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity lg:hidden"
          onClick={closeMobileMenu}
        />
      )}

      {/* Responsive Sidebar: fixed drawer on mobile, persistent column on desktop.
          On desktop it is sticky, not static: a static column the height of
          the viewport scrolls away with a long page and leaves the navigation
          (and Log out) out of reach. Sticky keeps it in the flex row — so the
          content column still sizes itself against it — while pinning it to
          the viewport. Only the middle link list scrolls, and only when the
          window is too short to show it all, so the page keeps its one
          scrollbar. */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-surface transition-transform duration-200 ease-in-out lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:shrink-0 lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        }`}
      >
        {navContent}
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur-xs sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg lg:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>Overview</span>
              <span>/</span>
              <span className="capitalize font-medium text-fg">
                {location.pathname.split('/')[1] || 'Dashboard'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-block text-xs text-muted">
              {staff?.name} <span className="text-faint">· {staff?.role}</span>
            </span>
            <Button
              variant="ghost"
              size="md"
              className="text-xs"
              onClick={() => void logout()}
            >
              <LogoutIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {staff?.status === 'PENDING_EMAIL_VERIFICATION' && (
            <EmailVerificationBanner email={staff.email} />
          )}
          <Outlet />
        </main>
      </div>

      {/* Owner Setup Guide (Tutorial) */}
      {staff?.role === 'OWNER' && organization?.onboardingCompletedAt == null && (
        <OnboardingTutorial />
      )}
    </div>
  );
}

/* Accessible SVG Icons */
function DashboardIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

function QueuesIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function StaffIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ReportsIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" x2="18" y1="20" y2="10" />
      <line x1="12" x2="12" y1="20" y2="4" />
      <line x1="6" x2="6" y1="20" y2="14" />
    </svg>
  );
}

function HistoryIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function AuditIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function OrgSettingsIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  );
}

function ProfileIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  );
}

function MenuIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

function LogoutIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

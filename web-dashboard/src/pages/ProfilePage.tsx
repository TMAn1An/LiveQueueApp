import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/Card';
import { SectionHeading } from '../components/SectionHeading';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { ErrorBanner } from '../components/ErrorBanner';
import { PasswordInput } from '../components/PasswordInput';
import { PageHeader } from '../components/PageHeader';
import { ApiError } from '../api/client';
import { formatDateTime } from '../utils/format';
import { MyRequests, RemovalRequestDialog } from '../components/MembershipRequests';
import { useRemovalRequests } from '../hooks/useStaff';

export function ProfilePage() {
  const { staff, organization, permissions, logout } = useAuth();

  if (!staff || !organization) return null;

  const initial = staff.name.trim() ? staff.name.trim()[0].toUpperCase() : 'U';

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Profile"
        description="View your staff permissions and update your security credentials."
      />

      <Card>
        <div className="mb-4 flex items-center gap-3.5 border-b border-border pb-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-600 text-base font-bold text-white shadow-xs">
            {initial}
          </div>
          <div>
            <h2 className="text-lg font-bold text-fg">{staff.name}</h2>
            <p className="text-xs text-muted">{staff.email}</p>
          </div>
          <div className="ml-auto">
            <StatusBadge status={staff.status} size="sm" />
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 text-sm">
          <div className="rounded-lg bg-subtle/50 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-faint">Role</dt>
            <dd className="mt-1 font-semibold text-fg">{staff.role}</dd>
          </div>
          <div className="rounded-lg bg-subtle/50 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-faint">Organization</dt>
            <dd className="mt-1 font-semibold text-fg">{organization.name}</dd>
          </div>
          <div className="rounded-lg bg-subtle/50 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-faint">Last Login</dt>
            <dd className="mt-1 text-fg">{formatDateTime(staff.lastLoginAt)}</dd>
          </div>
          <div className="rounded-lg bg-subtle/50 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-faint">Account Status</dt>
            <dd className="mt-1 text-fg">{staff.status}</dd>
          </div>
          <div className="col-span-full rounded-lg bg-subtle/50 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-faint mb-2">Granted Permissions</dt>
            <dd className="flex flex-wrap gap-1.5">
              {permissions.length === 0 ? (
                <span className="text-xs text-faint">None</span>
              ) : (
                permissions.map((p) => (
                  <span key={p} className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-mono text-muted">
                    {p}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <ChangePasswordCard />

      <MembershipCard />

      <div className="pt-2">
        <Button variant="secondary" onClick={() => void logout()}>
          Log out
        </Button>
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit() {
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <SectionHeading
        level={3}
        title="Change Password"
        help="Update the password you sign in with. Your other signed-in devices are signed out when it changes."
      />

      <ErrorBanner message={error} />
      {success && (
        <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Password updated successfully.
        </div>
      )}

      <div className="space-y-4 max-w-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="profile-current-password">
            Current Password
          </label>
          <PasswordInput
            id="profile-current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="profile-new-password">
            New Password
          </label>
          <PasswordInput
            id="profile-new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="profile-confirm-password">
            Confirm New Password
          </label>
          <PasswordInput
            id="profile-confirm-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {mismatch && (
            <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">Passwords do not match.</p>
          )}
        </div>
        <div className="pt-2">
          <Button
            size="lg"
            loading={isSubmitting}
            disabled={!currentPassword || !newPassword || !confirmPassword || mismatch || isSubmitting}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? 'Updating…' : 'Change Password'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * ADR-057: leaving the organization. Nobody removes themselves directly, so
 * staff and admins ask the owner here; the owner is told how the
 * organization itself is closed instead.
 */
function MembershipCard() {
  const { staff } = useAuth();
  const { data: requests, isLoading } = useRemovalRequests(staff?.role !== 'OWNER');
  const [requesting, setRequesting] = useState(false);
  const [sent, setSent] = useState(false);
  if (!staff) return null;

  const pendingLeave = (requests ?? []).some(
    (r) => r.status === 'PENDING' && r.requestType === 'SELF_LEAVE' && r.target.id === staff.id,
  );

  return (
    <Card>
      <SectionHeading
        level={3}
        title="Leave Organization"
        help="Nobody can remove themselves directly. A leave request goes to the organization owner, and you keep your access until they approve it."
      />
      {staff.role === 'OWNER' ? (
        <p className="text-sm text-fg-soft">
          As the owner you cannot leave the organization. To close it, delete the organization in
          Organization settings.
        </p>
      ) : (
        <div className="space-y-3">
          {sent && !pendingLeave && (
            <p className="text-sm font-medium text-fg-soft">Request sent to the owner.</p>
          )}
          <MyRequests />
          {/* Not offered until the requests have loaded, so it never flashes
              up for someone whose leave request is already pending. */}
          {!isLoading && !pendingLeave && (
            <Button variant="outline" onClick={() => setRequesting(true)}>
              Request to leave
            </Button>
          )}
        </div>
      )}
      {requesting && (
        <RemovalRequestDialog target="self" onClose={() => setRequesting(false)} onSent={() => setSent(true)} />
      )}
    </Card>
  );
}

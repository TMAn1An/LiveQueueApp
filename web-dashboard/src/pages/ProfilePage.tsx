import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiError } from '../api/client';
import { formatDateTime } from '../utils/format';

/**
 * Editing another staff member's record still requires `manage_staff`
 * (staff.service.ts gates PUT /api/staff/:staffId uniformly) — this page
 * only ever acts on the signed-in staff member's own account, via the
 * separate self-service password-change endpoint (ADR-022), not that route.
 */
export function ProfilePage() {
  const { staff, organization, permissions, logout } = useAuth();

  if (!staff || !organization) return null;

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Profile</h1>
      <Card>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-slate-400">Name</dt>
            <dd className="text-slate-900">{staff.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Email</dt>
            <dd className="text-slate-900">{staff.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Role</dt>
            <dd className="text-slate-900">{staff.role}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Status</dt>
            <dd>
              <StatusBadge status={staff.status} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Organization</dt>
            <dd className="text-slate-900">{organization.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Last Login</dt>
            <dd className="text-slate-900">{formatDateTime(staff.lastLoginAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Permissions</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {permissions.length === 0 ? (
                <span className="text-slate-400">None</span>
              ) : (
                permissions.map((p) => (
                  <span key={p} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {p}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      </Card>
      <ChangePasswordCard />
      <Button variant="secondary" onClick={() => void logout()}>
        Log out
      </Button>
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
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Change Password</h2>
      <ErrorBanner message={error} />
      {success && <p className="mb-3 text-sm text-green-600">Password changed successfully.</p>}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-slate-500">Current password</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-xs text-slate-500">New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs text-slate-500">Confirm new password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        {mismatch && <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>}
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Changing your password will sign you out of your other sessions on other devices.
      </p>
      <Button
        disabled={
          !currentPassword || !newPassword || !confirmPassword || mismatch || isSubmitting
        }
        onClick={() => void handleSubmit()}
      >
        {isSubmitting ? 'Changing…' : 'Change Password'}
      </Button>
    </Card>
  );
}

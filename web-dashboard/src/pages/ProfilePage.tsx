import { useAuth } from '../context/AuthContext';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime } from '../utils/format';

/**
 * Read-only: no endpoint exists for a staff member to edit their own record
 * without `manage_staff` (staff.service.ts gates PUT /api/staff/:staffId
 * uniformly — see the Phase 6 final report's "known limitations" for why
 * self-service editing wasn't added here without a product decision on
 * whether it should bypass that permission).
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
      <Button variant="secondary" onClick={() => void logout()}>
        Log out
      </Button>
    </div>
  );
}

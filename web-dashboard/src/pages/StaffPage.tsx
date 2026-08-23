import { useState } from 'react';
import { useCreateStaff, useDeleteStaff, useStaffList, useUpdateStaff } from '../hooks/useStaff';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { ErrorBanner } from '../components/ErrorBanner';
import { PermissionGate } from '../components/PermissionGate';
import { Pagination } from '../components/Pagination';
import { ApiError } from '../api/client';
import { PERMISSIONS, type Permission, type Staff, type StaffRole } from '../types/auth';

const MANAGEABLE_ROLES: Exclude<StaffRole, 'OWNER'>[] = ['ADMIN', 'ACCOUNTANT'];

function CreateStaffModal({ onClose }: { onClose: () => void }) {
  const createStaff = useCreateStaff();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Exclude<StaffRole, 'OWNER'>>('ADMIN');
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);

  function togglePermission(permission: Permission) {
    setPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission],
    );
  }

  async function handleSubmit() {
    setError(null);
    try {
      await createStaff.mutateAsync({ name, email, password, role, permissions });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create staff member.');
    }
  }

  return (
    <Modal title="Add Staff Member" onClose={onClose}>
      <ErrorBanner message={error} />
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Exclude<StaffRole, 'OWNER'>)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {MANAGEABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-xs text-slate-500">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-xs text-slate-500">Temporary password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs text-slate-500">Permissions</label>
        <div className="grid grid-cols-2 gap-1">
          {PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={permissions.includes(p)}
                onChange={() => togglePermission(p)}
              />
              {p}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!name || !email || password.length < 8 || createStaff.isPending}
          onClick={() => void handleSubmit()}
        >
          {createStaff.isPending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </Modal>
  );
}

function StaffRow({ staff }: { staff: Staff }) {
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 pr-4">{staff.name}</td>
      <td className="py-2 pr-4">{staff.email}</td>
      <td className="py-2 pr-4">{staff.role}</td>
      <td className="py-2 pr-4">
        <StatusBadge status={staff.status} />
      </td>
      <td className="py-2 pr-4">
        <PermissionGate permission="manage_staff">
          {staff.role !== 'OWNER' && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  updateStaff.mutate({
                    staffId: staff.id,
                    input: { status: staff.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
                  })
                }
              >
                {staff.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
              </Button>
              {!confirmingDelete ? (
                <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              ) : (
                <>
                  <Button variant="danger" onClick={() => deleteStaff.mutate(staff.id)}>
                    Confirm
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          )}
        </PermissionGate>
      </td>
    </tr>
  );
}

export function StaffPage() {
  const [page, setPage] = useState(1);
  const { data: result, isLoading } = useStaffList(page);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Staff</h1>
        <PermissionGate permission="manage_staff">
          <Button onClick={() => setShowCreate(true)}>Add Staff Member</Button>
        </PermissionGate>
      </div>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : !result?.data.length ? (
          <EmptyState message="No staff found." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((s) => (
                <StaffRow key={s.id} staff={s} />
              ))}
            </tbody>
          </table>
        )}
        <Pagination pagination={result?.pagination} onPageChange={setPage} />
      </Card>

      {showCreate && <CreateStaffModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

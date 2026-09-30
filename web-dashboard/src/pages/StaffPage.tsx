import { useState } from 'react';
import {
  useCreateStaff,
  useDeleteStaff,
  useResendInvitation,
  useStaffList,
  useUpdateStaff,
} from '../hooks/useStaff';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner, EmptyState, RefreshIndicator } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorBanner } from '../components/ErrorBanner';
import { PageHeader } from '../components/PageHeader';
import { actionErrorMessage } from '../utils/actionError';
import { PermissionGate } from '../components/PermissionGate';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { ApiError } from '../api/client';
import type { Staff, StaffRole } from '../types/auth';

const MANAGEABLE_ROLES: Exclude<StaffRole, 'OWNER'>[] = ['ADMIN', 'STAFF'];

function CreateStaffModal({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: (result: { name: string; emailSent: boolean }) => void;
}) {
  const createStaff = useCreateStaff();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<StaffRole, 'OWNER'>>('ADMIN');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    try {
      const created = await createStaff.mutateAsync({ name, email, role });
      onInvited({ name, emailSent: created.data.invitationEmailSent });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create staff member.');
    }
  }

  return (
    <Modal title="Invite Staff Member" onClose={onClose}>
      <ErrorBanner message={error} />
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="staff-name">
              Name
            </label>
            <input
              id="staff-name"
              value={name}
              placeholder="e.g. John Doe"
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg focus:border-brand-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="staff-role">
              Role
            </label>
            <select
              id="staff-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Exclude<StaffRole, 'OWNER'>)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg focus:border-brand-500"
            >
              {MANAGEABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="staff-email">
            Email
          </label>
          <input
            id="staff-email"
            type="email"
            value={email}
            placeholder="colleague@example.com"
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg focus:border-brand-500"
          />
        </div>

        <p className="rounded-lg bg-subtle p-3 text-xs text-muted">
          We'll email them a link to set their own password and sign in. Permissions are determined
          entirely by the selected role and cannot be customized.
        </p>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={createStaff.isPending}
            disabled={!name || !email || createStaff.isPending}
            onClick={() => void handleSubmit()}
          >
            {createStaff.isPending ? 'Sending invitation…' : 'Send invitation'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StaffRow({ staff }: { staff: Staff }) {
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();
  const resendInvitation = useResendInvitation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [resendNote, setResendNote] = useState<string | null>(null);

  async function handleResend() {
    setResendNote(null);
    try {
      const result = await resendInvitation.mutateAsync(staff.id);
      setResendNote(result.data.emailSent ? 'Invitation sent.' : 'Could not send the email.');
    } catch (err) {
      setResendNote(err instanceof ApiError ? err.message : 'Could not send the invitation.');
    }
  }

  const initial = staff.name.trim() ? staff.name.trim()[0].toUpperCase() : 'S';

  return (
    <tr className="border-b border-border transition-colors hover:bg-subtle/50">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xs font-bold dark:bg-brand-950 dark:text-brand-300">
            {initial}
          </div>
          <span className="font-semibold text-fg">{staff.name}</span>
        </div>
      </td>
      <td className="py-3 pr-4 text-sm text-fg-soft">{staff.email}</td>
      <td className="py-3 pr-4">
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
          staff.role === 'OWNER'
            ? 'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
            : staff.role === 'ADMIN'
              ? 'bg-brand-50 text-brand-700 border border-brand-200 dark:bg-brand-950/60 dark:text-brand-300 dark:border-brand-800'
              : 'bg-subtle text-fg-soft border border-border'
        }`}>
          {staff.role}
        </span>
      </td>
      <td className="py-3 pr-4">
        {staff.invitationPending ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Invitation pending
          </span>
        ) : (
          <StatusBadge status={staff.status} size="sm" />
        )}
      </td>
      <td className="py-3 pr-4">
        <PermissionGate permission="manage_staff">
          {staff.role !== 'OWNER' && (
            <div className="flex flex-wrap items-center gap-2">
              {staff.invitationPending && (
                <>
                  <Button
                    variant="secondary"
                    loading={resendInvitation.isPending}
                    disabled={resendInvitation.isPending}
                    onClick={() => void handleResend()}
                  >
                    {resendInvitation.isPending ? 'Sending…' : 'Resend invite'}
                  </Button>
                  {resendNote && <span className="text-xs text-muted">{resendNote}</span>}
                </>
              )}
              <Button
                variant="secondary"
                loading={updateStaff.isPending}
                onClick={() => {
                  setRowError(null);
                  updateStaff.mutate(
                    {
                      staffId: staff.id,
                      input: { status: staff.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
                    },
                    { onError: (err) => setRowError(actionErrorMessage(err)) },
                  );
                }}
              >
                {updateStaff.isPending
                  ? 'Updating…'
                  : staff.status === 'ACTIVE'
                    ? 'Suspend'
                    : 'Reactivate'}
              </Button>
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            </div>
          )}
        </PermissionGate>
        {rowError && <div className="mt-2"><ErrorBanner message={rowError} /></div>}
        {confirmingDelete && (
          <ConfirmDialog
            title={`Remove staff member "${staff.name}"?`}
            message="They will immediately lose access to the dashboard. This cannot be undone."
            confirming={deleteStaff.isPending}
            onConfirm={() =>
              deleteStaff.mutate(staff.id, {
                onSuccess: () => setConfirmingDelete(false),
                onError: (err) => {
                  setConfirmingDelete(false);
                  setRowError(actionErrorMessage(err));
                },
              })
            }
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </td>
    </tr>
  );
}

export function StaffPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const { data: result, isLoading, isFetching } = useStaffList(page, 20, debouncedSearch);
  const [showCreate, setShowCreate] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<{ name: string; emailSent: boolean } | null>(null);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Invite colleagues, assign operational roles, and manage access to LiveQueue."
        actions={
          <PermissionGate permission="manage_staff">
            <Button size="lg" variant="primary" onClick={() => setShowCreate(true)}>
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              Invite Staff Member
            </Button>
          </PermissionGate>
        }
      />

      {inviteNotice && (
        <div
          className={
            inviteNotice.emailSent
              ? 'rounded-xl border border-border bg-subtle p-4 text-sm font-medium text-fg shadow-xs'
              : 'rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900 shadow-xs dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'
          }
        >
          {inviteNotice.emailSent
            ? `Invitation email sent to ${inviteNotice.name}.`
            : `${inviteNotice.name} was added, but the invitation email could not be sent. Use “Resend invite” on their row.`}
        </div>
      )}

      <div className="max-w-md">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          label="Search staff"
          placeholder="Search by name, email, or role…"
        />
      </div>

      {isFetching && !isLoading && (
        <div className="flex justify-end">
          <RefreshIndicator />
        </div>
      )}

      <Card>
        {isLoading ? (
          <Spinner label="Loading staff…" />
        ) : !result?.data.length ? (
          <EmptyState
            message={debouncedSearch ? 'No staff match your search.' : 'No staff found.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase font-semibold text-faint">
                  <th className="py-3 pr-4">Name</th>
                  <th className="py-3 pr-4">Email</th>
                  <th className="py-3 pr-4">Role</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((s) => (
                  <StaffRow key={s.id} staff={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={result?.pagination} onPageChange={setPage} />
      </Card>

      {showCreate && (
        <CreateStaffModal onClose={() => setShowCreate(false)} onInvited={setInviteNotice} />
      )}
    </div>
  );
}

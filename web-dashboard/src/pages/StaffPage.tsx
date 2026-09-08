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
import { ErrorBanner } from '../components/ErrorBanner';
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
  /** Reports back whether the invitation actually went out, so the page can
   * say so plainly rather than the modal claiming success and vanishing. */
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
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="staff-name">
            Name
          </label>
          <input
            id="staff-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border-strong px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted" htmlFor="staff-role">
            Role
          </label>
          <select
            id="staff-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Exclude<StaffRole, 'OWNER'>)}
            className="w-full rounded-md border border-border-strong px-2 py-1 text-sm"
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
        <label className="mb-1 block text-xs text-muted" htmlFor="staff-email">
          Email
        </label>
        <input
          id="staff-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-border-strong px-2 py-1 text-sm"
        />
      </div>
      {/* ADR-035: no password field. They receive a link and choose their
          own, so an administrator never handles a colleague's password. */}
      <p className="mb-2 text-xs text-muted">
        We'll email them a link to set their own password and sign in. Permissions are determined
        entirely by the selected role and cannot be customized.
      </p>
      <div className="mb-4 flex justify-end gap-2">
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
    </Modal>
  );
}

function StaffRow({ staff }: { staff: Staff }) {
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();
  const resendInvitation = useResendInvitation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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

  return (
    <tr className="border-b border-border transition-colors duration-150 hover:bg-subtle">
      <td className="py-2 pr-4">{staff.name}</td>
      <td className="py-2 pr-4">{staff.email}</td>
      <td className="py-2 pr-4">{staff.role}</td>
      <td className="py-2 pr-4">
        {staff.invitationPending ? (
          // A clearer statement than the raw status: this person has not
          // finished setting up, and the row offers the way to fix it.
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Invitation pending
          </span>
        ) : (
          <StatusBadge status={staff.status} />
        )}
      </td>
      <td className="py-2 pr-4">
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
                onClick={() =>
                  updateStaff.mutate({
                    staffId: staff.id,
                    input: { status: staff.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
                  })
                }
              >
                {updateStaff.isPending
                  ? 'Updating…'
                  : staff.status === 'ACTIVE'
                    ? 'Suspend'
                    : 'Reactivate'}
              </Button>
              {!confirmingDelete ? (
                <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              ) : (
                <>
                  <Button
                    variant="danger"
                    loading={deleteStaff.isPending}
                    onClick={() => deleteStaff.mutate(staff.id)}
                  >
                    {deleteStaff.isPending ? 'Deleting…' : 'Confirm'}
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
  const [search, setSearch] = useState('');
  // Server-side search: this list is paginated, so filtering only the loaded
  // page would hide matches sitting on other pages.
  const debouncedSearch = useDebouncedValue(search.trim());
  const { data: result, isLoading, isFetching } = useStaffList(page, 20, debouncedSearch);
  const [showCreate, setShowCreate] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<{ name: string; emailSent: boolean } | null>(null);

  function handleSearchChange(value: string) {
    setSearch(value);
    // A new search re-queries from the start; staying on page 3 of the old
    // result set would usually land past the end of the new one.
    setPage(1);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-fg">Staff</h1>
        <PermissionGate permission="manage_staff">
          <Button onClick={() => setShowCreate(true)}>Invite Staff Member</Button>
        </PermissionGate>
      </div>

      {/* Says what actually happened. A created account whose invitation
          bounced is not a failure to hide — it is a thing to fix with the
          Resend action on that person's row. */}
      {inviteNotice && (
        <div
          className={
            inviteNotice.emailSent
              ? 'mb-4 rounded-md border border-border bg-subtle p-3 text-sm text-fg-soft'
              : 'mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'
          }
        >
          {inviteNotice.emailSent
            ? `Invitation email sent to ${inviteNotice.name}.`
            : `${inviteNotice.name} was added, but the invitation email could not be sent. Use “Resend invite” on their row.`}
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          label="Search staff"
          placeholder="Search by name, email, or role…"
        />
      </div>

      {/* Rows already on screen stay put while a new search loads —
          blanking them on every keystroke would be worse than the wait. */}
      {isFetching && !isLoading && (
        <div className="mb-2 flex justify-end">
          <RefreshIndicator />
        </div>
      )}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !result?.data.length ? (
          <EmptyState
            message={debouncedSearch ? 'No staff match your search.' : 'No staff found.'}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-faint">
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

      {showCreate && (
        <CreateStaffModal onClose={() => setShowCreate(false)} onInvited={setInviteNotice} />
      )}
    </div>
  );
}

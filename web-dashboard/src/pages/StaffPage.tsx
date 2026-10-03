import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useAdmins,
  useSetExecutiveWorkspace,
  useCreateStaff,
  useDeleteStaff,
  useRemovalRequests,
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
import { MyRequests, OwnerRequestInbox, RemovalRequestDialog } from '../components/MembershipRequests';
import { FieldError } from '../components/FieldError';
import { InfoHelp } from '../components/InfoHelp';
import { useAuth } from '../context/AuthContext';
import { latinNameError } from '../utils/latinText';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { ApiError } from '../api/client';
import { AdminFilter } from '../components/AdminFilter';
import { roleLabel, type Staff, type StaffRole } from '../types/auth';

type InvitableRole = Exclude<StaffRole, 'OWNER'>;

/** ADR-069 (D4): only the Organization Head invites Admins and Managers; an
 * Admin invites Executives, into their own workspace. */
function invitableRoles(actorRole: StaffRole | undefined): InvitableRole[] {
  return actorRole === 'OWNER' ? ['ADMIN', 'STAFF', 'MANAGER'] : actorRole === 'ADMIN' ? ['STAFF'] : [];
}

const ROLE_HELP =
  'Permissions come entirely from the role. The Organization Head runs the organization and appoints Admins and Managers. Each Admin runs one queue with their own Executives. Executives serve people at counters. An Organization Manager sees every workspace, report and audit entry, and may delete a queue, but does not operate or configure queues.';

function CreateStaffModal({
  onClose,
  onInvited,
  initialRole,
}: {
  onClose: () => void;
  onInvited: (result: { name: string; emailSent: boolean }) => void;
  initialRole?: InvitableRole;
}) {
  const createStaff = useCreateStaff();
  const { staff: actor } = useAuth();
  const roles = invitableRoles(actor?.role);
  const isHead = actor?.role === 'OWNER';
  const { admins } = useAdmins(isHead);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>(
    initialRole && roles.includes(initialRole) ? initialRole : (roles[0] ?? 'STAFF'),
  );
  // The Head may place a new Executive straight into an Admin's workspace.
  const [workspaceAdminId, setWorkspaceAdminId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nameError = latinNameError(name);

  async function handleSubmit() {
    setError(null);
    try {
      const created = await createStaff.mutateAsync({
        name: name.trim(),
        email,
        role,
        ...(isHead && role === 'STAFF' && workspaceAdminId ? { workspaceAdminId } : {}),
      });
      onInvited({ name, emailSent: created.data.invitationEmailSent });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create staff member.');
    }
  }

  return (
    <Modal title={roles.length === 1 ? `Invite ${roleLabel(roles[0])}` : 'Invite Member'} onClose={onClose}>
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
              aria-invalid={nameError ? true : undefined}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
            />
            <FieldError message={nameError} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-0.5">
              <label className="block text-xs font-medium text-fg-soft" htmlFor="staff-role">
                Role
              </label>
              <InfoHelp label="roles">{ROLE_HELP}</InfoHelp>
            </div>
            <select
              id="staff-role"
              value={role}
              disabled={roles.length < 2}
              onChange={(e) => setRole(e.target.value as InvitableRole)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isHead && role === 'STAFF' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="staff-workspace">
              Workspace
            </label>
            <select
              id="staff-workspace"
              value={workspaceAdminId}
              onChange={(e) => setWorkspaceAdminId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
            >
              <option value="">Organization-level (no Admin yet)</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}&apos;s workspace
                </option>
              ))}
            </select>
          </div>
        )}

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
            className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
          />
        </div>

        <p className="text-xs text-muted">
          We'll email them a link to set their own password and sign in.
        </p>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={createStaff.isPending}
            disabled={!name.trim() || !email || Boolean(nameError)}
            onClick={() => void handleSubmit()}
          >
            {createStaff.isPending ? 'Sending invitation…' : 'Send invitation'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * ADR-057: what the signed-in person may do to this row. Mirrors
 * membership.service.ts on the backend, which decides regardless.
 */
function rowActions(actor: Staff | null, target: Staff) {
  const isSelf = actor?.id === target.id;
  const isOwnerActor = actor?.role === 'OWNER';
  const isAdminActor = actor?.role === 'ADMIN';
  // ADR-069: a Manager only looks. An Admin acts on their own Executives
  // (the list the server gives them holds no one else's).
  if (actor?.role === 'MANAGER') {
    return {
      isSelf,
      canRemove: false,
      canRequestRemoval: false,
      canRequestLeave: isSelf,
      canManage: false,
      canSuspend: false,
      canChangeRole: false,
      canSetWorkspace: false,
    };
  }
  return {
    // ADR-069 (D4): only the Head promotes, demotes and appoints Managers.
    canChangeRole: isOwnerActor && !isSelf && target.role !== 'OWNER',
    // ADR-069 (D3): only the Head moves an Executive between workspaces.
    canSetWorkspace: isOwnerActor && target.role === 'STAFF',
    isSelf,
    // Nobody removes themselves, and nobody removes the owner.
    canRemove:
      !isSelf &&
      target.role !== 'OWNER' &&
      (isOwnerActor || (isAdminActor && target.role === 'STAFF')),
    // An admin asks the owner about another admin.
    canRequestRemoval: !isSelf && isAdminActor && target.role === 'ADMIN',
    // An admin's own leave request lives on their own row.
    canRequestLeave: isSelf && isAdminActor,
    // Invitations: never on the owner or yourself.
    canManage: target.role !== 'OWNER' && !isSelf,
    // ADR-061: suspension follows removal — the owner suspends admins and
    // staff, an admin only staff, nobody themselves or the owner.
    canSuspend:
      !isSelf &&
      target.role !== 'OWNER' &&
      (isOwnerActor || (isAdminActor && target.role === 'STAFF')),
  };
}

function StaffRow({
  staff,
  pendingAbout,
  adminNames,
}: {
  staff: Staff;
  pendingAbout: boolean;
  adminNames: Map<string, string>;
}) {
  const { staff: actor } = useAuth();
  const setWorkspace = useSetExecutiveWorkspace();
  const [confirmingRole, setConfirmingRole] = useState<InvitableRole | null>(null);
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();
  const resendInvitation = useResendInvitation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNote, setRowNote] = useState<string | null>(null);
  const actions = rowActions(actor, staff);

  function setStatus(status: 'ACTIVE' | 'SUSPENDED') {
    setRowError(null);
    updateStaff.mutate(
      { staffId: staff.id, input: { status } },
      {
        onSuccess: () => setConfirmingSuspend(false),
        onError: (err) => {
          setConfirmingSuspend(false);
          setRowError(actionErrorMessage(err));
        },
      },
    );
  }

  async function handleResend() {
    setRowNote(null);
    try {
      const result = await resendInvitation.mutateAsync(staff.id);
      setRowNote(result.data.emailSent ? 'Invitation sent.' : 'Could not send the email.');
    } catch (err) {
      setRowNote(err instanceof ApiError ? err.message : 'Could not send the invitation.');
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
          {actions.isSelf && <span className="text-xs font-medium text-muted">(you)</span>}
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
          {roleLabel(staff.role)}
        </span>
        {actions.canChangeRole && (
          <div className="mt-1">
            <label htmlFor={`role-${staff.id}`} className="sr-only">
              Change {staff.name}&apos;s role
            </label>
            <select
              id={`role-${staff.id}`}
              value=""
              onChange={(e) => e.target.value && setConfirmingRole(e.target.value as InvitableRole)}
              className="rounded-md border border-border-strong bg-surface px-2 py-0.5 text-xs text-fg focus:border-brand-500"
            >
              <option value="">Change role…</option>
              {(['ADMIN', 'STAFF', 'MANAGER'] as InvitableRole[])
                .filter((r) => r !== staff.role)
                .map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
            </select>
          </div>
        )}
      </td>
      <td className="py-3 pr-4 text-xs text-fg-soft">
        {staff.role === 'STAFF' ? (
          actions.canSetWorkspace ? (
            <>
              <label htmlFor={`workspace-${staff.id}`} className="sr-only">
                {staff.name}&apos;s workspace
              </label>
              <select
                id={`workspace-${staff.id}`}
                value={staff.workspaceAdminId ?? ''}
                disabled={setWorkspace.isPending}
                onChange={(e) => {
                  setRowError(null);
                  setWorkspace.mutate(
                    { staffId: staff.id, adminId: e.target.value || null },
                    { onError: (err) => setRowError(actionErrorMessage(err)) },
                  );
                }}
                className="rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-fg focus:border-brand-500"
              >
                <option value="">Organization-level</option>
                {[...adminNames].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </>
          ) : staff.workspaceAdminId ? (
            staff.workspaceAdminId === actor?.id ? 'Your workspace' : (adminNames.get(staff.workspaceAdminId) ?? 'An Admin')
          ) : (
            'Organization-level'
          )
        ) : staff.role === 'ADMIN' ? (
          'Own workspace'
        ) : (
          'Whole organization'
        )}
      </td>
      <td className="py-3 pr-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {staff.invitationPending ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Invitation pending
            </span>
          ) : (
            <StatusBadge status={staff.status} size="sm" />
          )}
          {pendingAbout && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Removal requested
            </span>
          )}
        </div>
      </td>
      <td className="py-3 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          {actions.canManage && staff.invitationPending && (
            <Button
              variant="secondary"
              loading={resendInvitation.isPending}
              onClick={() => void handleResend()}
            >
              {resendInvitation.isPending ? 'Sending…' : 'Resend invite'}
            </Button>
          )}
          {actions.canSuspend && (
            <Button
              variant="secondary"
              loading={updateStaff.isPending}
              onClick={() => {
                // Suspending is confirmed first; reactivating is not.
                if (staff.status === 'ACTIVE') setConfirmingSuspend(true);
                else setStatus('ACTIVE');
              }}
            >
              {updateStaff.isPending
                ? 'Updating…'
                : staff.status === 'ACTIVE'
                  ? 'Suspend'
                  : 'Reactivate'}
            </Button>
          )}
          {actions.canRequestRemoval && !pendingAbout && (
            <Button variant="outline" onClick={() => setRequesting(true)}>
              Request removal
            </Button>
          )}
          {actions.canRequestLeave && !pendingAbout && (
            <Button variant="outline" onClick={() => setRequesting(true)}>
              Request to leave
            </Button>
          )}
          {actions.canRemove && (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Remove
            </Button>
          )}
        </div>
        {rowNote && <p className="mt-1 text-xs text-muted">{rowNote}</p>}
        {rowError && <div className="mt-2"><ErrorBanner message={rowError} /></div>}
        {requesting && (
          <RemovalRequestDialog
            target={actions.isSelf ? 'self' : { id: staff.id, name: staff.name }}
            onClose={() => setRequesting(false)}
            onSent={() => setRowNote('Request sent to the owner.')}
          />
        )}
        {confirmingRole && (
          <ConfirmDialog
            title={`Make ${staff.name} ${roleLabel(confirmingRole)}?`}
            message={
              staff.role === 'ADMIN'
                ? `${staff.name} stops being an Admin. Their queue and Executives return to you (Head-managed) until you assign them to another Admin.`
                : `${staff.name}'s permissions change to those of ${roleLabel(confirmingRole)}. If they can no longer operate their counter, it is turned off.`
            }
            confirmLabel="Change role"
            confirmingLabel="Changing…"
            tone="primary"
            confirming={updateStaff.isPending}
            onConfirm={() => {
              setRowError(null);
              updateStaff.mutate(
                { staffId: staff.id, input: { role: confirmingRole } },
                {
                  onSuccess: () => setConfirmingRole(null),
                  onError: (err) => {
                    setConfirmingRole(null);
                    setRowError(actionErrorMessage(err));
                  },
                },
              );
            }}
            onCancel={() => setConfirmingRole(null)}
          />
        )}
        {confirmingSuspend && (
          <ConfirmDialog
            title={`Suspend ${staff.name}?`}
            message="They will be signed out and cannot sign in until they are reactivated."
            confirmLabel="Suspend"
            confirmingLabel="Suspending…"
            confirming={updateStaff.isPending}
            onConfirm={() => setStatus('SUSPENDED')}
            onCancel={() => setConfirmingSuspend(false)}
          />
        )}
        {confirmingDelete && (
          <ConfirmDialog
            title={`Remove ${staff.name}?`}
            message="They will be removed from the organization and signed out on every device immediately. This cannot be undone."
            confirmLabel="Remove"
            confirmingLabel="Removing…"
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
  const [adminFilter, setAdminFilter] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const { data: result, isLoading, isFetching } = useStaffList(page, 20, debouncedSearch, adminFilter);
  const { staff: actor, hasPermission } = useAuth();
  const isOwner = actor?.role === 'OWNER';
  const organizationWide = hasPermission('view_all_workspaces');
  const { admins } = useAdmins(organizationWide);
  const adminNames = new Map(admins.map((a) => [a.id, a.name]));
  const roles = invitableRoles(actor?.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRole = searchParams.get('invite') as InvitableRole | null;
  const { data: requests } = useRemovalRequests();
  const pendingTargets = new Set(
    (requests ?? []).filter((r) => r.status === 'PENDING').map((r) => r.target.id),
  );
  // ?invite=ROLE (e.g. from Create Queue's "Invite Executive") opens the form.
  const [showCreate, setShowCreate] = useState(Boolean(requestedRole) && roles.length > 0);
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
            {roles.length > 0 && (
              <Button size="lg" variant="primary" onClick={() => setShowCreate(true)}>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                {roles.length === 1 ? `Invite ${roleLabel(roles[0])}` : 'Invite Member'}
              </Button>
            )}
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

      {isOwner ? <OwnerRequestInbox /> : <MyRequests />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full max-w-md">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          label="Search staff"
          placeholder="Search by name, email, or role…"
        />
        </div>
        {organizationWide && (
          <AdminFilter
            id="staff-admin-filter"
            value={adminFilter}
            onChange={(v) => {
              setAdminFilter(v);
              setPage(1);
            }}
          />
        )}
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
                  <th className="py-3 pr-4">Workspace</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((s) => (
                  <StaffRow
                    key={s.id}
                    staff={s}
                    pendingAbout={pendingTargets.has(s.id)}
                    adminNames={adminNames}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={result?.pagination} onPageChange={setPage} />
      </Card>

      {showCreate && (
        <CreateStaffModal
          initialRole={requestedRole ?? undefined}
          onClose={() => {
            setShowCreate(false);
            if (requestedRole) setSearchParams({}, { replace: true });
          }}
          onInvited={setInviteNotice}
        />
      )}
    </div>
  );
}

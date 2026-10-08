import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminReplacementDialog } from '../components/AdminReplacementDialog';
import type { TransferOutcome } from '../api/staff.api';
import {
  useAdmins,
  useSetExecutiveWorkspace,
  useCreateStaff,
  useDeleteStaff,
  useRemovalRequests,
  useResendInvitation,
  useRoleChangeImpact,
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
  // ADR-071 D13: every new Executive belongs to an Admin's workspace — the
  // Head chooses which (an Admin's own invitations go into their own).
  const [workspaceAdminId, setWorkspaceAdminId] = useState('');
  const needsWorkspace = isHead && role === 'STAFF';
  const [error, setError] = useState<string | null>(null);
  const nameError = latinNameError(name);

  async function handleSubmit() {
    setError(null);
    try {
      const created = await createStaff.mutateAsync({
        name: name.trim(),
        email,
        role,
        ...(needsWorkspace ? { workspaceAdminId } : {}),
      });
      onInvited({ name, emailSent: created.data.invitationEmailSent });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invitation. Please try again.');
    }
  }

  return (
    <Modal title={roles.length === 1 ? `Invite ${roleLabel(roles[0])}` : 'Invite associate'} onClose={onClose}>
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

        {needsWorkspace && (
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="staff-workspace">
              Admin workspace
            </label>
            <select
              id="staff-workspace"
              value={workspaceAdminId}
              onChange={(e) => setWorkspaceAdminId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
            >
              <option value="">Choose an Admin…</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}&apos;s workspace
                </option>
              ))}
            </select>
            {admins.length === 0 && (
              <p className="mt-1 text-xs text-muted">Invite an Admin first — every Executive works in an Admin&apos;s workspace.</p>
            )}
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
            disabled={!name.trim() || !email || Boolean(nameError) || (needsWorkspace && !workspaceAdminId)}
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

/**
 * ADR-071: changing someone's role. For an Admin, the impact is checked first
 * — one who still runs a queue or has Executives is handed to the guided
 * replacement flow. Making someone an Executive asks which Admin's workspace
 * they join.
 */
function RoleChangeFlow({
  staff,
  role,
  adminNames,
  onClose,
  onNeedsReplacement,
  onError,
}: {
  staff: Staff;
  role: InvitableRole;
  adminNames: Map<string, string>;
  onClose: () => void;
  onNeedsReplacement: (intended: TransferOutcome) => void;
  onError: (err: unknown) => void;
}) {
  const updateStaff = useUpdateStaff();
  const impact = useRoleChangeImpact(staff.role === 'ADMIN' ? staff.id : null);
  const [workspaceAdminId, setWorkspaceAdminId] = useState('');
  const intended: TransferOutcome = role === 'MANAGER' ? 'MANAGER' : 'EXECUTIVE';
  const requiresReplacement = staff.role === 'ADMIN' && impact.data?.requiresReplacement === true;

  useEffect(() => {
    if (requiresReplacement && role !== 'ADMIN') onNeedsReplacement(intended);
  }, [requiresReplacement, role, intended, onNeedsReplacement]);

  if (staff.role === 'ADMIN' && impact.isLoading) {
    return (
      <Modal title={`Change ${staff.name}'s role`} onClose={onClose}>
        <Spinner label="Checking what this affects…" />
      </Modal>
    );
  }
  if (requiresReplacement) return null;

  const destinations = [...adminNames].filter(([id]) => id !== staff.id);
  const needsWorkspace = role === 'STAFF';
  function apply() {
    updateStaff.mutate(
      { staffId: staff.id, input: { role, ...(needsWorkspace ? { workspaceAdminId } : {}) } },
      { onSuccess: onClose, onError },
    );
  }

  return (
    <Modal title={`Make ${staff.name} ${roleLabel(role)}?`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-fg-soft">
          {staff.name}&apos;s permissions change to those of {roleLabel(role)}. They are signed out of live
          updates and continue with their new access. If they can no longer operate their counter, it is turned
          off — this is refused while they are serving someone.
        </p>
        {needsWorkspace && (
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor={`role-workspace-${staff.id}`}>
              Admin workspace
            </label>
            <select
              id={`role-workspace-${staff.id}`}
              value={workspaceAdminId}
              onChange={(e) => setWorkspaceAdminId(e.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
            >
              <option value="">Choose an Admin…</option>
              {destinations.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}&apos;s workspace
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={updateStaff.isPending}
            disabled={updateStaff.isPending || (needsWorkspace && !workspaceAdminId)}
            onClick={apply}
          >
            {updateStaff.isPending ? 'Changing…' : 'Change role'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** ADR-071: before removing an Admin, check whether a replacement is needed. */
function RemovalCheck({
  staffId,
  onClear,
  onNeedsReplacement,
  onClose,
}: {
  staffId: string;
  onClear: () => void;
  onNeedsReplacement: () => void;
  onClose: () => void;
}) {
  const impact = useRoleChangeImpact(staffId);
  useEffect(() => {
    if (!impact.data) return;
    if (impact.data.requiresReplacement) onNeedsReplacement();
    else onClear();
  }, [impact.data, onClear, onNeedsReplacement]);
  return (
    <Modal title="Checking…" onClose={onClose}>
      {impact.isError ? <ErrorBanner message={actionErrorMessage(impact.error)} /> : <Spinner label="Checking what this affects…" />}
    </Modal>
  );
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
  // ADR-071: an Admin who still runs a queue (or has Executives) leaves the
  // role only by handing the workspace to a replacement.
  const [replacing, setReplacing] = useState<TransferOutcome | null>(null);
  const [checkingRemoval, setCheckingRemoval] = useState(false);
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();
  const resendInvitation = useResendInvitation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNote, setRowNote] = useState<string | null>(null);
  const actions = rowActions(actor, staff);

  /** A refusal that means "hand the workspace over first" opens the guided
   * replacement flow instead of only showing the error. */
  function handleGovernanceError(err: unknown, intended: TransferOutcome) {
    if (err instanceof ApiError && (err.code === 'ADMIN_OWNS_LIVE_QUEUE' || err.code === 'ADMIN_HAS_EXECUTIVES')) {
      setReplacing(intended);
      return;
    }
    setRowError(actionErrorMessage(err));
  }

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
                  if (!e.target.value) return;
                  setWorkspace.mutate(
                    { staffId: staff.id, adminId: e.target.value },
                    { onError: (err) => setRowError(actionErrorMessage(err)) },
                  );
                }}
                className="rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-fg focus:border-brand-500"
              >
                {/* ADR-071 D13: every Executive belongs to an Admin; an older
                    organization-level Executive is shown as unplaced until moved. */}
                {!staff.workspaceAdminId && (
                  <option value="" disabled>
                    Choose an Admin…
                  </option>
                )}
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
            <Button
              variant="danger"
              onClick={() => (staff.role === 'ADMIN' && actor?.role === 'OWNER' ? setCheckingRemoval(true) : setConfirmingDelete(true))}
            >
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
          <RoleChangeFlow
            staff={staff}
            role={confirmingRole}
            adminNames={adminNames}
            onClose={() => setConfirmingRole(null)}
            onNeedsReplacement={(intended) => {
              setConfirmingRole(null);
              setReplacing(intended);
            }}
            onError={(err) => {
              setConfirmingRole(null);
              handleGovernanceError(err, confirmingRole === 'MANAGER' ? 'MANAGER' : 'EXECUTIVE');
            }}
          />
        )}
        {checkingRemoval && (
          <RemovalCheck
            staffId={staff.id}
            onClear={() => {
              setCheckingRemoval(false);
              setConfirmingDelete(true);
            }}
            onNeedsReplacement={() => {
              setCheckingRemoval(false);
              setReplacing('REMOVE');
            }}
            onClose={() => setCheckingRemoval(false)}
          />
        )}
        {replacing && (
          <AdminReplacementDialog
            key={replacing}
            admin={{ id: staff.id, name: staff.name }}
            intended={replacing}
            onClose={() => setReplacing(null)}
            onDone={(message) => setRowNote(message)}
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
                  handleGovernanceError(err, 'REMOVE');
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
        title="Associates"
        description="Invite colleagues, assign operational roles, and manage access to LiveQueue."
        actions={
          <PermissionGate permission="manage_staff">
            {roles.length > 0 && (
              <Button size="lg" variant="primary" onClick={() => setShowCreate(true)}>
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                {roles.length === 1 ? `Invite ${roleLabel(roles[0])}` : 'Invite associate'}
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
          label="Search associates"
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
          <Spinner label="Loading associates…" />
        ) : !result?.data.length ? (
          <EmptyState
            message={debouncedSearch ? 'No associates match your search.' : 'No associates yet.'}
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

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  useDeleteOrganization,
  useOrganization,
  useRestartOnboarding,
  useUpdateOrganization,
} from '../hooks/useOrganization';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { PageHeader } from '../components/PageHeader';
import { OrganizationNameStatus } from '../components/OrganizationNameStatus';
import { useOrganizationNameAvailability } from '../hooks/useOrganizationNameAvailability';
import { ApiError } from '../api/client';
import { browserTimezone, supportedTimezones, timezoneOptions } from '../utils/timezone';

export function OrganizationSettingsPage() {
  const { staff, logout, refreshIdentity } = useAuth();
  const navigate = useNavigate();
  const { data: organization, isLoading } = useOrganization();
  const zones = useMemo(() => supportedTimezones(), []);
  const [timezone, setTimezone] = useState('');
  const updateOrganization = useUpdateOrganization();
  const deleteOrganization = useDeleteOrganization();
  const restartOnboarding = useRestartOnboarding();
  const [restarted, setRestarted] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const nameStatus = useOrganizationNameAvailability(name, organization?.name);
  const [confirmName, setConfirmName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = staff?.role === 'OWNER';

  if (isLoading || !organization) return <Spinner label="Loading organization settings…" />;

  async function handleSave() {
    setError(null);
    try {
      await updateOrganization.mutateAsync({ name, timezone: timezone.trim() || null });
      setEditing(false);
      // The sidebar and page headers read the organization from the session
      // identity, so re-read it or they keep showing the old name.
      await refreshIdentity().catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update organization.');
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteOrganization.mutateAsync(confirmName);
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete organization.');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Settings"
        description="Configure your organization profile, default timezone, and setup guidance."
      />

      <Card>
        <div className="mb-4 border-b border-border pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-fg">Organization Profile</h2>
            <p className="text-xs text-muted">Legal name and default timezone for all queues</p>
          </div>
          {isOwner && !editing && (
            <Button
              variant="secondary"
              onClick={() => {
                setName(organization.name);
                setTimezone(organization.timezone ?? browserTimezone() ?? '');
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
        </div>

        <ErrorBanner message={error} />

        {editing ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="org-name">
                Organization Name
              </label>
              <input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby="org-name-status"
                aria-invalid={nameStatus === 'taken' || undefined}
                className="w-full max-w-md rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg focus:border-brand-500"
              />
              <OrganizationNameStatus status={nameStatus} id="org-name-status" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="org-timezone">
                Timezone
              </label>
              {zones ? (
                <select
                  id="org-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full max-w-md rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg focus:border-brand-500"
                >
                  <option value="">Not set</option>
                  {timezoneOptions(zones, organization.timezone, browserTimezone()).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="org-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Asia/Dhaka"
                  className="w-full max-w-md rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg focus:border-brand-500"
                />
              )}
              <p className="mt-1 text-xs text-muted">
                Your queues use this clock unless one of them sets its own. It also decides when a
                monthly or yearly repeat limit rolls over.
              </p>
            </div>
            <div className="flex gap-2 pt-2 border-t border-border">
              <Button
                loading={updateOrganization.isPending}
                disabled={nameStatus === 'taken'}
                onClick={() => void handleSave()}
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-subtle/50 p-3">
              <dt className="text-xs font-semibold uppercase tracking-wider text-faint">Name</dt>
              <dd className="mt-1 text-lg font-bold text-fg">{organization.name}</dd>
            </div>
            <div className="rounded-lg bg-subtle/50 p-3">
              <dt className="text-xs font-semibold uppercase tracking-wider text-faint">Timezone</dt>
              <dd className="mt-1 text-sm font-medium text-fg-soft">
                {organization.timezone ?? 'Not set'}
              </dd>
            </div>
          </dl>
        )}

        {!isOwner && (
          <p className="mt-3 text-xs text-faint">Only the organization owner can edit these settings.</p>
        )}
      </Card>

      {/* Owner Guided Tour / Setup Guide */}
      {isOwner && (
        <Card>
          <div className="mb-3 border-b border-border pb-3">
            <h2 className="text-base font-bold text-fg">Setup Guide</h2>
            <p className="text-xs text-muted">
              Walk through the guided tour of setting up a queue again — creating a queue, adding
              services and counters, inviting staff, and generating a QR code.
            </p>
          </div>
          <Button
            variant="secondary"
            loading={restartOnboarding.isPending}
            onClick={() =>
              restartOnboarding.mutate(undefined, { onSuccess: () => setRestarted(true) })
            }
          >
            {restartOnboarding.isPending ? 'Restarting…' : 'Restart tutorial'}
          </Button>
          {restarted && (
            <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              The guide will reappear the next time you load the dashboard.
            </p>
          )}
        </Card>
      )}

      {/* Danger Zone */}
      {isOwner && (
        <Card className="border-rose-200 dark:border-rose-900/60 bg-rose-50/20">
          <div className="mb-3 border-b border-rose-200 dark:border-rose-900/60 pb-3">
            <h2 className="text-base font-bold text-rose-700 dark:text-rose-400">Delete Organization</h2>
            <p className="text-xs text-muted">
              This permanently deletes the organization and all of its staff, queues, services,
              counters, and token history. This action cannot be undone.
            </p>
          </div>

          {!confirmingDelete ? (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete Organization
            </Button>
          ) : (
            <div className="space-y-3 rounded-lg border border-rose-200 bg-surface p-4">
              <label className="block text-sm text-fg-soft">
                Type <strong>{organization.name}</strong> to confirm:
              </label>
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder="Enter organization name"
                className="w-full max-w-sm rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-fg focus:border-rose-500"
              />
              <div className="flex gap-2 pt-2">
                <Button
                  variant="danger"
                  disabled={confirmName !== organization.name || deleteOrganization.isPending}
                  onClick={() => void handleDelete()}
                >
                  {deleteOrganization.isPending ? 'Deleting…' : 'Permanently Delete'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDeleteOrganization, useOrganization, useUpdateOrganization } from '../hooks/useOrganization';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { ErrorBanner } from '../components/ErrorBanner';
import { ApiError } from '../api/client';

/**
 * Spec 7.1: only the owner may edit/delete the organization; deletion is
 * destructive and requires typing the organization name to confirm — the
 * backend re-verifies this itself (organization.service.ts), this UI flow
 * is the first, not the only, safeguard (CLAUDE.md section 10).
 */
export function OrganizationSettingsPage() {
  const { staff, logout } = useAuth();
  const navigate = useNavigate();
  const { data: organization, isLoading } = useOrganization();
  const updateOrganization = useUpdateOrganization();
  const deleteOrganization = useDeleteOrganization();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = staff?.role === 'OWNER';

  if (isLoading || !organization) return <Spinner />;

  async function handleSave() {
    setError(null);
    try {
      await updateOrganization.mutateAsync(name);
      setEditing(false);
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
      <h1 className="text-xl font-semibold text-slate-900">Organization Settings</h1>

      <Card>
        <ErrorBanner message={error} />
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Organization Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full max-w-sm rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void handleSave()}>Save</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400">Name</p>
              <p className="text-lg font-medium text-slate-900">{organization.name}</p>
            </div>
            {isOwner && (
              <Button
                variant="secondary"
                onClick={() => {
                  setName(organization.name);
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            )}
          </div>
        )}
        {!isOwner && (
          <p className="mt-3 text-xs text-slate-400">Only the organization owner can edit these settings.</p>
        )}
      </Card>

      {isOwner && (
        <Card className="border-red-200">
          <h2 className="mb-2 text-sm font-semibold text-red-700">Delete Organization</h2>
          <p className="mb-3 text-sm text-slate-500">
            This permanently deletes the organization and all of its staff, queues, services,
            counters, and token history. This action cannot be undone.
          </p>
          {!confirmingDelete ? (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete Organization
            </Button>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm text-slate-700">
                Type <strong>{organization.name}</strong> to confirm:
              </label>
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="w-full max-w-sm rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              <div className="flex gap-2">
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

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { FieldError } from './FieldError';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { useRoleChangeImpact, useTransferWorkspace } from '../hooks/useStaff';
import type { TransferOutcome } from '../api/staff.api';
import { roleLabel } from '../types/auth';
import { actionErrorMessage } from '../utils/actionError';
import { latinTextError } from '../utils/latinText';

const OUTCOMES: { value: TransferOutcome; label: (name: string) => string }[] = [
  { value: 'MANAGER', label: (name) => `${name} becomes an Organization Manager` },
  { value: 'EXECUTIVE', label: (name) => `${name} becomes an Executive in the new Admin’s workspace` },
  { value: 'REMOVE', label: (name) => `${name} leaves the organization` },
];

/**
 * ADR-071: every live queue keeps exactly one Admin. When the Organization
 * Head changes the role of — or removes — an Admin who still manages a queue
 * or has Executives, this guides them to hand the workspace to a replacement
 * first, in one step: the queue, its counters, services, tokens and history
 * stay exactly as they are; only who runs it changes.
 */
export function AdminReplacementDialog({
  admin,
  intended,
  onClose,
  onDone,
}: {
  admin: { id: string; name: string };
  /** What the Head was trying to do when the dialog opened. */
  intended: TransferOutcome;
  onClose: () => void;
  onDone?: (message: string) => void;
}) {
  const navigate = useNavigate();
  const impact = useRoleChangeImpact(admin.id);
  const transfer = useTransferWorkspace();
  const [replacementId, setReplacementId] = useState('');
  const [outcome, setOutcome] = useState<TransferOutcome>(intended);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const data = impact.data;
  const replacement = data?.eligibleReplacements.find((r) => r.id === replacementId);
  const reasonError = latinTextError(reason) ?? latinTextError(note);
  const canConfirm = Boolean(replacement) && reason.trim().length >= 3 && !reasonError && !transfer.isPending;

  async function confirm() {
    setError(null);
    try {
      await transfer.mutateAsync({
        adminId: admin.id,
        input: { replacementStaffId: replacementId, outcome, reason: reason.trim(), ...(note.trim() ? { note: note.trim() } : {}) },
      });
      onDone?.(`${replacement!.name} now runs ${data?.liveQueue?.name ?? 'the workspace'}.`);
      onClose();
    } catch (err) {
      setError(actionErrorMessage(err));
    }
  }

  return (
    <Modal title={`Replace ${admin.name} as Admin`} onClose={onClose}>
      {impact.isLoading || !data ? (
        impact.isError ? (
          <ErrorBanner message={actionErrorMessage(impact.error)} />
        ) : (
          <Spinner label="Checking what this affects…" />
        )
      ) : (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <p className="text-sm text-fg-soft">
            {data.liveQueue
              ? `${admin.name} currently manages ${data.liveQueue.name}. Choose a replacement Admin before changing this role.`
              : `${admin.name} still has ${data.executiveCount} Executive${data.executiveCount === 1 ? '' : 's'} in their workspace. Choose a replacement Admin to take them over.`}
          </p>

          {data.eligibleReplacements.length === 0 ? (
            <div className="rounded-lg border border-border bg-subtle/50 p-3 text-sm text-fg-soft">
              Nobody can take over yet. A replacement must be an active Admin without a queue, or an active
              Organization Manager or Executive. Invite an Admin, then come back once they have set up their
              account.
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="replacement-admin">
                  Replacement Admin
                </label>
                <select
                  id="replacement-admin"
                  value={replacementId}
                  onChange={(e) => setReplacementId(e.target.value)}
                  className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
                >
                  <option value="">Choose who takes over…</option>
                  {data.eligibleReplacements.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {roleLabel(r.role)}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset>
                <legend className="mb-1 text-xs font-medium text-fg-soft">Then</legend>
                <div className="space-y-1.5">
                  {OUTCOMES.map((o) => (
                    <label key={o.value} className="flex items-center gap-2 text-sm text-fg">
                      <input
                        type="radio"
                        name="old-admin-outcome"
                        value={o.value}
                        checked={outcome === o.value}
                        onChange={() => setOutcome(o.value)}
                      />
                      {o.label(admin.name)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="transfer-reason">
                  Reason
                </label>
                <input
                  id="transfer-reason"
                  value={reason}
                  maxLength={200}
                  placeholder="e.g. Moving to the head office"
                  onChange={(e) => setReason(e.target.value)}
                  className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="transfer-note">
                  Note (optional)
                </label>
                <textarea
                  id="transfer-note"
                  value={note}
                  maxLength={500}
                  rows={2}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500"
                />
                <FieldError message={reasonError} />
              </div>

              {replacement && (
                <div className="rounded-lg border border-border bg-subtle/50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">What happens</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-fg-soft">
                    {data.liveQueue && (
                      <li>
                        {data.liveQueue.name} moves to {replacement.name}.
                      </li>
                    )}
                    {data.executiveCount > 0 && (
                      <li>
                        {data.executiveCount} Executive{data.executiveCount === 1 ? '' : 's'} move
                        {data.executiveCount === 1 ? 's' : ''} to {replacement.name}&apos;s workspace.
                      </li>
                    )}
                    {replacement.role !== 'ADMIN' && <li>{replacement.name} becomes an Admin.</li>}
                    <li>The queue, its counters, services, tokens and history stay exactly as they are.</li>
                    <li>{OUTCOMES.find((o) => o.value === outcome)!.label(admin.name)}.</li>
                    <li>Earlier activity stays recorded under the people who did it.</li>
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  navigate('/staff?invite=ADMIN');
                }}
              >
                Invite replacement Admin
              </Button>
              {data?.liveQueue && (
                <Link
                  to={`/queues/${data.liveQueue.id}`}
                  className="inline-flex items-center px-2 text-sm font-medium text-brand-600 hover:underline"
                  onClick={onClose}
                >
                  Delete the queue instead
                </Link>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!canConfirm} loading={transfer.isPending} onClick={() => void confirm()}>
                {transfer.isPending ? 'Handing over…' : 'Hand over workspace'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

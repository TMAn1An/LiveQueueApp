import { useState } from 'react';
import { Card } from './Card';
import { SectionHeading } from './SectionHeading';
import { Button } from './Button';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { ErrorBanner } from './ErrorBanner';
import { FieldError } from './FieldError';
import { PasswordInput } from './PasswordInput';
import { ConfirmDialog } from './ConfirmDialog';
import {
  useCancelSuccession,
  useLeadership,
  useResendSuccessorLink,
  useStartSuccession,
  useVerifySuccession,
} from '../hooks/useLeadership';
import { SUCCESSION_REASONS, reasonLabel, type Succession, type SuccessionReason } from '../api/leadership.api';
import { actionErrorMessage } from '../utils/actionError';
import { latinNameError, latinTextError } from '../utils/latinText';
import { formatDateTime } from '../utils/format';

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

const STATUS_TEXT: Record<Succession['status'], { title: string; tone: string }> = {
  AWAITING_VERIFICATION: { title: 'Awaiting verification', tone: 'text-amber-800 dark:text-amber-300' },
  AWAITING_ACCEPTANCE: { title: 'Awaiting successor acceptance', tone: 'text-amber-800 dark:text-amber-300' },
  EXPIRED: { title: 'Expired', tone: 'text-muted' },
  CANCELLED: { title: 'Cancelled', tone: 'text-muted' },
  DECLINED: { title: 'Declined', tone: 'text-rose-700 dark:text-rose-400' },
  COMPLETED: { title: 'Completed', tone: 'text-emerald-700 dark:text-emerald-300' },
};

/**
 * ADR-071: who leads the organization, and how leadership is handed over.
 *
 * What is shown is decided by the server (D5): the Organization Head sees the
 * full history with private notes and can hand over leadership; an
 * Organization Manager sees the history and reasons without notes; Admins
 * and Executives see only who the current Head is. Historical tenure has no
 * edit or delete controls anywhere.
 */
export function OrganizationLeadership({ isHead }: { isHead: boolean }) {
  const { data, isLoading, error } = useLeadership();
  const [wizardOpen, setWizardOpen] = useState(false);

  if (isLoading) return <Card><Spinner label="Loading leadership…" /></Card>;
  if (error || !data) return null;

  const open = data.succession && (data.succession.status === 'AWAITING_VERIFICATION' || data.succession.status === 'AWAITING_ACCEPTANCE');

  return (
    <Card>
      <SectionHeading
        title="Organization Leadership"
        help="Who leads this organization, and who led it before. Handing over leadership is a formal step: the current Organization Head confirms it with their password and an emailed code, and the successor accepts it themselves."
      />
      <div className="space-y-4">
        <div className="rounded-lg bg-subtle/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-faint">Current Organization Head</p>
          {data.current ? (
            <>
              <p className="mt-1 text-base font-bold text-fg">{data.current.name}</p>
              <p className="text-xs text-muted">Since {formatDay(data.current.since)}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">Not recorded.</p>
          )}
        </div>

        {data.previous && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Previous Heads</p>
            {data.previous.length === 0 ? (
              <p className="text-sm text-muted">No previous Heads.</p>
            ) : (
              <ul className="space-y-2">
                {data.previous.map((p) => (
                  <li key={`${p.name}-${p.startedAt}`} className="rounded-lg border border-border p-3">
                    <p className="font-semibold text-fg">{p.name}</p>
                    <p className="text-xs text-muted">
                      {formatMonth(p.startedAt)} – {formatMonth(p.endedAt)}
                      {p.reason ? ` · ${reasonLabel(p.reason)}` : ''}
                    </p>
                    {p.note && <p className="mt-1 text-xs text-fg-soft">Note: {p.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isHead && data.succession && <SuccessionStatusCard succession={data.succession} />}

        {isHead && !open && (
          <Button variant="secondary" onClick={() => setWizardOpen(true)}>
            Transfer organization leadership
          </Button>
        )}
      </div>
      {wizardOpen && <TransferLeadershipWizard onClose={() => setWizardOpen(false)} />}
    </Card>
  );
}

/** The current or most recent handover, with what can still be done. */
function SuccessionStatusCard({ succession }: { succession: Succession }) {
  const verify = useVerifySuccession();
  const resend = useResendSuccessorLink();
  const cancel = useCancelSuccession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const { title, tone } = STATUS_TEXT[succession.status];
  const s = succession;

  async function submitCode() {
    setError(null);
    try {
      const res = await verify.mutateAsync({ id: s.id, code });
      setCode('');
      setNote(
        res.data.successorEmailSent
          ? `We emailed ${s.successor.name} a link to accept. It works once and expires in 72 hours.`
          : `The link could not be emailed to ${s.successor.name}. Use "Send the link again".`,
      );
    } catch (err) {
      setError(actionErrorMessage(err));
    }
  }

  return (
    <div className="rounded-lg border border-border p-3" aria-label="Leadership handover status">
      <p className={`text-sm font-semibold ${tone}`}>{title}</p>
      <p className="mt-0.5 text-xs text-muted">
        Handover to {s.successor.name} ({s.successor.email}) · {reasonLabel(s.reason)} · started{' '}
        {formatDateTime(s.createdAt)}
      </p>
      <ErrorBanner message={error} />
      {note && <p className="mt-2 text-xs text-fg-soft">{note}</p>}

      {s.status === 'AWAITING_VERIFICATION' && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-fg-soft" htmlFor="succession-code">
            Enter the 6-digit code we emailed you
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="succession-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="h-9 w-32 rounded-md border border-border-strong bg-surface px-3 text-sm tracking-widest text-fg focus:border-brand-500"
            />
            <Button disabled={code.length !== 6} loading={verify.isPending} onClick={() => void submitCode()}>
              Confirm
            </Button>
          </div>
          <p className="text-xs text-muted">The code expires 10 minutes after it was sent. {s.attemptsLeft} attempts left.</p>
        </div>
      )}

      {s.status === 'AWAITING_ACCEPTANCE' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={resend.isPending}
            onClick={() =>
              resend.mutate(s.id, {
                onSuccess: () => setNote(`A new link was sent to ${s.successor.name}. The previous one no longer works.`),
                onError: (err) => setError(actionErrorMessage(err)),
              })
            }
          >
            Send the link again
          </Button>
        </div>
      )}

      {(s.status === 'AWAITING_VERIFICATION' || s.status === 'AWAITING_ACCEPTANCE') && (
        <div className="mt-3">
          <Button variant="outline" onClick={() => setConfirmingCancel(true)}>
            Cancel handover
          </Button>
        </div>
      )}

      {confirmingCancel && (
        <ConfirmDialog
          title="Cancel this handover?"
          message={`${s.successor.name} will no longer be able to accept. You stay the Organization Head.`}
          confirmLabel="Cancel handover"
          confirmingLabel="Cancelling…"
          cancelLabel="Keep it"
          confirming={cancel.isPending}
          onConfirm={() =>
            cancel.mutate(s.id, {
              onSuccess: () => setConfirmingCancel(false),
              onError: (err) => {
                setConfirmingCancel(false);
                setError(actionErrorMessage(err));
              },
            })
          }
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
    </div>
  );
}

/**
 * Successor → reason → password, then the code arrives by email and is
 * entered on the status card. Nothing changes until the successor accepts.
 */
function TransferLeadershipWizard({ onClose }: { onClose: () => void }) {
  const start = useStartSuccession();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [successorEmail, setSuccessorEmail] = useState('');
  const [successorName, setSuccessorName] = useState('');
  const [reason, setReason] = useState<SuccessionReason | ''>('');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const nameError = latinNameError(successorName);
  const noteError = latinTextError(note);
  const otherNeedsNote = reason === 'OTHER' && note.trim().length < 10;
  const emailLooksValid = /^\S+@\S+\.\S+$/.test(successorEmail.trim());

  async function submit() {
    setError(null);
    try {
      await start.mutateAsync({
        successorEmail: successorEmail.trim(),
        ...(successorName.trim() ? { successorName: successorName.trim() } : {}),
        reason: reason as SuccessionReason,
        ...(note.trim() ? { note: note.trim() } : {}),
        currentPassword: password,
      });
      onClose();
    } catch (err) {
      setError(actionErrorMessage(err));
    }
  }

  return (
    <Modal title="Transfer organization leadership" onClose={onClose}>
      <div className="space-y-4">
        <ol className="flex gap-2 text-xs text-muted" aria-label="Steps">
          {['Successor', 'Reason', 'Confirm'].map((label, i) => (
            <li key={label} className={step === i + 1 ? 'font-semibold text-fg' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
        <ErrorBanner message={error} />

        {step === 1 && (
          <>
            <p className="text-sm text-fg-soft">
              The successor can be someone new, or an active Organization Manager or Executive of this organization.
              An Admin who runs a queue hands over their workspace first.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="successor-email">
                Successor&apos;s email
              </label>
              <input
                id="successor-email"
                type="email"
                value={successorEmail}
                onChange={(e) => setSuccessorEmail(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="successor-name">
                Successor&apos;s name (if they are new to the organization)
              </label>
              <input
                id="successor-name"
                value={successorName}
                onChange={(e) => setSuccessorName(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
              />
              <FieldError message={nameError} />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="succession-reason">
                Reason for the handover
              </label>
              <select
                id="succession-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as SuccessionReason)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500"
              >
                <option value="">Choose a reason…</option>
                {SUCCESSION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="succession-note">
                {reason === 'OTHER' ? 'Describe the reason' : 'Note (optional, visible only to the Organization Head)'}
              </label>
              <textarea
                id="succession-note"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500"
              />
              <p className="text-xs text-muted">{note.length}/500{reason === 'OTHER' ? ' · at least 10 characters' : ''}</p>
              <FieldError message={noteError} />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="rounded-lg border border-border bg-subtle/50 p-3 text-sm text-fg-soft">
              <p>
                You are handing the Organization Head role to <strong>{successorName.trim() || successorEmail.trim()}</strong>{' '}
                ({successorEmail.trim()}) — {reasonLabel(reason as SuccessionReason)}.
              </p>
              <p className="mt-2">
                When they accept, your account for this organization is closed and you are signed out everywhere.
                Until then, you can cancel at any time.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-soft" htmlFor="succession-password">
                Your current password
              </label>
              <PasswordInput
                id="succession-password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted">We will then email you a 6-digit code to confirm it was you.</p>
            </div>
          </>
        )}

        <div className="flex justify-between gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as 1 | 2 | 3)}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step === 1 && (
            <Button disabled={!emailLooksValid || Boolean(nameError)} onClick={() => setStep(2)}>
              Next
            </Button>
          )}
          {step === 2 && (
            <Button disabled={!reason || otherNeedsNote || Boolean(noteError)} onClick={() => setStep(3)}>
              Next
            </Button>
          )}
          {step === 3 && (
            <Button disabled={!password} loading={start.isPending} onClick={() => void submit()}>
              {start.isPending ? 'Sending code…' : 'Send verification code'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

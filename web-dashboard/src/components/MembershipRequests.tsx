import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  useCancelRemovalRequest,
  useCreateRemovalRequest,
  useRemovalRequests,
  useReviewRemovalRequest,
} from '../hooks/useStaff';
import { Modal } from './Modal';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { FieldError } from './FieldError';
import { SectionHeading } from './SectionHeading';
import { Card } from './Card';
import { actionErrorMessage } from '../utils/actionError';
import { latinTextError } from '../utils/latinText';
import { formatDateTime } from '../utils/format';
import type { MembershipRemovalRequest } from '../types/auth';
import { roleLabel } from '../types/auth';

/**
 * ADR-057: asking the owner to end a membership — your own (a leave
 * request) or, for an admin, another admin's. Nothing changes until the owner
 * approves, and the dialog says so before anything is sent.
 */
export function RemovalRequestDialog({
  target,
  onClose,
  onSent,
}: {
  target: { id: string; name: string } | 'self';
  onClose: () => void;
  onSent?: () => void;
}) {
  const { staff } = useAuth();
  const createRequest = useCreateRemovalRequest();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isSelf = target === 'self' || target.id === staff?.id;
  const reasonError = latinTextError(reason);

  async function submit() {
    if (!staff) return;
    setError(null);
    try {
      await createRequest.mutateAsync({
        targetStaffId: target === 'self' ? staff.id : target.id,
        reason: reason.trim() || undefined,
      });
      onSent?.();
      onClose();
    } catch (err) {
      setError(actionErrorMessage(err));
    }
  }

  return (
    <Modal title={isSelf ? 'Request to leave' : 'Request removal'} onClose={onClose}>
      <ErrorBanner message={error} />
      <div className="space-y-4">
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200">
          {target === 'self' || isSelf
            ? 'This sends a leave request to the organization owner. You keep your access until the owner approves it.'
            : `This asks the organization owner to remove ${target.name}. Nothing changes until the owner approves it.`}
        </p>
        <div>
          <label htmlFor="removal-request-reason" className="mb-1 block text-sm font-medium text-fg-soft">
            Reason <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="removal-request-reason"
            rows={3}
            maxLength={500}
            value={reason}
            aria-invalid={reasonError ? true : undefined}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500"
          />
          <FieldError message={reasonError} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={createRequest.isPending}
            disabled={Boolean(reasonError)}
            onClick={() => void submit()}
          >
            {createRequest.isPending ? 'Sending…' : 'Send to owner'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const TYPE_LABEL: Record<MembershipRemovalRequest['requestType'], string> = {
  SELF_LEAVE: 'Leave request',
  ADMIN_REMOVAL_REQUEST: 'Admin removal request',
};

const STATUS_CLASS: Record<MembershipRemovalRequest['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  APPROVED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'bg-subtle text-fg-soft',
  CANCELLED: 'bg-subtle text-muted',
};

function RequestSummary({ request }: { request: MembershipRemovalRequest }) {
  const self = request.requester.id === request.target.id;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-fg">{TYPE_LABEL[request.requestType]}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[request.status]}`}>
          {request.status.charAt(0) + request.status.slice(1).toLowerCase()}
        </span>
      </div>
      <p className="mt-1 text-sm text-fg-soft">
        {self
          ? `${request.requester.name} (${roleLabel(request.target.role)}) asks to leave.`
          : `${request.requester.name} asks to remove ${request.target.name} (${roleLabel(request.target.role)}).`}
      </p>
      {request.reason && <p className="mt-1 text-sm text-muted">“{request.reason}”</p>}
      <p className="mt-1 text-xs text-faint">Sent {formatDateTime(request.createdAt)}</p>
    </div>
  );
}

/**
 * The owner's inbox of pending requests, with Approve and Reject. Approving
 * removes the member at once, so it is confirmed first.
 */
export function OwnerRequestInbox() {
  const { data: requests } = useRemovalRequests();
  const review = useReviewRemovalRequest();
  const [confirming, setConfirming] = useState<MembershipRemovalRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = (requests ?? []).filter((r) => r.status === 'PENDING');

  if (pending.length === 0) return null;

  async function decide(request: MembershipRemovalRequest, decision: 'approve' | 'reject') {
    setError(null);
    try {
      await review.mutateAsync({ requestId: request.id, decision });
      setConfirming(null);
    } catch (err) {
      setConfirming(null);
      setError(actionErrorMessage(err));
    }
  }

  return (
    <Card>
      <SectionHeading
        title={`Pending requests (${pending.length})`}
        help="Leave requests from your team, and admins asking you to remove another admin. Approving removes the person and signs them out at once."
      />
      <ErrorBanner message={error} />
      <ul className="divide-y divide-border">
        {pending.map((request) => (
          <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <RequestSummary request={request} />
            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                disabled={review.isPending}
                onClick={() => void decide(request, 'reject')}
              >
                Reject
              </Button>
              <Button variant="danger" disabled={review.isPending} onClick={() => setConfirming(request)}>
                Approve
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {confirming && (
        <Modal title={`Remove ${confirming.target.name}?`} onClose={() => setConfirming(null)}>
          <p className="mb-4 text-sm text-fg-soft">
            Approving removes {confirming.target.name} from the organization and signs them out on every
            device. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={review.isPending} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={review.isPending}
              onClick={() => void decide(confirming, 'approve')}
            >
              {review.isPending ? 'Removing…' : 'Approve and remove'}
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/** A non-owner's own requests (made by or about them), with Withdraw. */
export function MyRequests() {
  const { staff } = useAuth();
  const { data: requests } = useRemovalRequests();
  const cancel = useCancelRemovalRequest();
  const [error, setError] = useState<string | null>(null);
  const mine = (requests ?? []).filter((r) => r.status === 'PENDING');

  if (mine.length === 0) return null;

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} />
      <ul className="divide-y divide-border rounded-lg border border-border">
        {mine.map((request) => (
          <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
            <RequestSummary request={request} />
            {request.requester.id === staff?.id && (
              <Button
                variant="secondary"
                loading={cancel.isPending}
                onClick={() => {
                  setError(null);
                  cancel.mutate(request.id, { onError: (err) => setError(actionErrorMessage(err)) });
                }}
              >
                Withdraw
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { useDeleteQueue } from '../hooks/useQueues';
import { actionErrorMessage } from '../utils/actionError';
import { latinTextError } from '../utils/latinText';
import type { Queue } from '../types/queue';

const MAX_REASON = 500;

/**
 * ADR-069 (D8): deleting a queue always says why. Anyone still waiting has
 * their place cancelled, and only they may see the reason; nobody who has
 * finished is affected. It is refused while someone is being called or
 * served — the backend decides that, and its message is shown as-is.
 */
export function DeleteQueueDialog({
  queue,
  onClose,
  onDeleted,
}: {
  queue: Pick<Queue, 'id' | 'name' | 'waitingCount'>;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const deleteQueue = useDeleteQueue();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reasonError = latinTextError(reason);
  const canSubmit = reason.trim().length > 0 && !reasonError && !deleteQueue.isPending;
  const waiting = queue.waitingCount ?? null;

  return (
    <Modal title={`Delete queue "${queue.name}"?`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setError(null);
          deleteQueue.mutate(
            { queueId: queue.id, reason: reason.trim() },
            {
              onSuccess: () => {
                onDeleted?.();
                onClose();
              },
              onError: (err) => setError(actionErrorMessage(err)),
            },
          );
        }}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg-soft">
          <li>
            {waiting === null
              ? 'Anyone still waiting will have their place cancelled.'
              : waiting === 0
                ? 'Nobody is waiting right now.'
                : `${waiting} ${waiting === 1 ? 'person is' : 'people are'} waiting and will have their place cancelled.`}{' '}
            They will see the reason below; nobody else will.
          </li>
          <li>A cancelled place does not use up anyone&apos;s repeat-visit allowance.</li>
          <li>It cannot be deleted while someone is being called or served.</li>
          <li>This cannot be undone.</li>
        </ul>
        <div>
          <label htmlFor="delete-queue-reason" className="mb-1 block text-sm font-medium text-fg-soft">
            Reason (required)
          </label>
          <textarea
            id="delete-queue-reason"
            value={reason}
            maxLength={MAX_REASON}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby="delete-queue-reason-hint"
            placeholder="e.g. This service point has closed permanently."
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg focus:border-brand-500 aria-invalid:border-red-500"
          />
          <p id="delete-queue-reason-hint" className="mt-1 text-xs text-muted">
            {reasonError ?? `${reason.length}/${MAX_REASON}`}
          </p>
        </div>
        <ErrorBanner message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={deleteQueue.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!canSubmit} loading={deleteQueue.isPending}>
            {deleteQueue.isPending ? 'Deleting…' : 'Delete queue'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

import { useState, type FormEvent } from 'react';
import { useCompleteToken } from '../hooks/useTokenActions';
import { Modal } from './Modal';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { actionErrorMessage } from '../utils/actionError';
import { COMPLETION_FEEDBACK_MAX_LENGTH } from '../types/terminalNotes';

/**
 * ADR-042: the optional path. Plain Complete stays one click; this is only
 * for when staff want to leave the customer a note. Blank feedback simply
 * completes as usual — the backend stores nothing for it.
 */
export function CompleteWithFeedbackDialog({ tokenId, onClose }: { tokenId: string; onClose: () => void }) {
  const completeToken = useCompleteToken();
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);

  const trimmed = feedback.trim();
  const tooLong = trimmed.length > COMPLETION_FEEDBACK_MAX_LENGTH;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (tooLong || completeToken.isPending) return;
    setError(null);
    completeToken.mutate(
      { tokenId, feedback: trimmed.length > 0 ? trimmed : undefined },
      { onSuccess: onClose, onError: (err) => setError(actionErrorMessage(err)) },
    );
  }

  return (
    <Modal title="Complete with feedback" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <div>
          <label htmlFor={`completion-feedback-${tokenId}`} className="mb-1 block text-sm font-medium text-fg-soft">
            Feedback for the customer (optional)
          </label>
          <textarea
            id={`completion-feedback-${tokenId}`}
            autoFocus
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Please bring the original document next time."
            className="w-full rounded-md border border-border-strong px-3 py-2 text-sm"
          />
          <p className={`mt-1 text-xs ${tooLong ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}>
            {trimmed.length}/{COMPLETION_FEEDBACK_MAX_LENGTH} · The customer sees this in their app.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={completeToken.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={tooLong} loading={completeToken.isPending}>
            {completeToken.isPending ? 'Completing…' : 'Complete'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

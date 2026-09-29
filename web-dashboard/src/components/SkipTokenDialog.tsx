import { useState, type FormEvent } from 'react';
import { useSkipToken } from '../hooks/useTokenActions';
import { Modal } from './Modal';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { actionErrorMessage } from '../utils/actionError';
import {
  SKIP_REASON_OPTIONS,
  SKIP_REASON_TEXT_MAX_LENGTH,
  type SkipReasonCode,
} from '../types/terminalNotes';

/**
 * ADR-042: skipping a customer always says why. The customer reads the
 * reason in their app, so Skip stays disabled until there is one — a
 * predefined reason, or Other with the staff member's own words. The backend
 * enforces the same rule; this only spares staff a round trip.
 */
export function SkipTokenDialog({ tokenId, onClose }: { tokenId: string; onClose: () => void }) {
  const skipToken = useSkipToken();
  const [reasonCode, setReasonCode] = useState<SkipReasonCode | ''>('');
  const [reasonText, setReasonText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isOther = reasonCode === 'OTHER';
  const trimmedText = reasonText.trim();
  const textTooLong = trimmedText.length > SKIP_REASON_TEXT_MAX_LENGTH;
  const canSkip =
    reasonCode !== '' && (!isOther || (trimmedText.length > 0 && !textTooLong)) && !skipToken.isPending;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (reasonCode === '' || !canSkip) return;
    setError(null);
    skipToken.mutate(
      { tokenId, reasonCode, reasonText: isOther ? trimmedText : undefined },
      { onSuccess: onClose, onError: (err) => setError(actionErrorMessage(err)) },
    );
  }

  return (
    <Modal title="Skip customer" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <p className="text-sm text-muted">
          The customer will see this reason. Skipping ends their visit; they would need to scan the
          queue QR code again.
        </p>
        <div>
          <label htmlFor={`skip-reason-${tokenId}`} className="mb-1 block text-sm font-medium text-fg-soft">
            Reason
          </label>
          <select
            id={`skip-reason-${tokenId}`}
            autoFocus
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as SkipReasonCode | '')}
            className="w-full rounded-md border border-border-strong px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Choose a reason…
            </option>
            {SKIP_REASON_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {isOther && (
          <div>
            <label htmlFor={`skip-reason-text-${tokenId}`} className="mb-1 block text-sm font-medium text-fg-soft">
              Describe the reason
            </label>
            <input
              id={`skip-reason-text-${tokenId}`}
              type="text"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              maxLength={SKIP_REASON_TEXT_MAX_LENGTH + 50}
              className="w-full rounded-md border border-border-strong px-3 py-2 text-sm"
            />
            <p className={`mt-1 text-xs ${textTooLong ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}>
              {trimmedText.length === 0
                ? 'Required when the reason is Other.'
                : `${trimmedText.length}/${SKIP_REASON_TEXT_MAX_LENGTH}`}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={skipToken.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!canSkip} loading={skipToken.isPending}>
            {skipToken.isPending ? 'Skipping…' : 'Skip'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

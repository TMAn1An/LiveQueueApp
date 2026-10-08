import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReferralOptions } from '../api/token.api';
import { useCompleteToken } from '../hooks/useTokenActions';
import { Modal } from './Modal';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { Spinner } from './Spinner';
import { actionErrorMessage } from '../utils/actionError';
import { latinTextError } from '../utils/latinText';

const MAX_NOTE = 500;

/**
 * ADR-070: finish this step and refer the person's next step to a counter
 * that handles it — for when this counter does not. The referred person is
 * that counter's next, after whoever it is serving now; nobody is
 * interrupted. The note is optional and visible to staff only.
 */
export function ReferralDialog({ tokenId, onClose }: { tokenId: string; onClose: () => void }) {
  const completeToken = useCompleteToken();
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['referralOptions', tokenId],
    queryFn: async () => (await getReferralOptions(tokenId)).data,
  });
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const noteError = latinTextError(note);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!target || noteError || completeToken.isPending) return;
    setError(null);
    completeToken.mutate(
      { tokenId, referral: { referToCounterId: target, referralNote: note.trim() || undefined } },
      { onSuccess: onClose, onError: (err) => setError(actionErrorMessage(err)) },
    );
  }

  return (
    <Modal title="Complete step and refer" onClose={onClose}>
      {isLoading ? (
        <Spinner label="Finding counters…" />
      ) : loadError || !data ? (
        <ErrorBanner message={actionErrorMessage(loadError)} />
      ) : !data.nextStep ? (
        <p className="text-sm text-fg-soft">This is the person&apos;s last step — there is nothing to refer.</p>
      ) : data.currentCounterHandlesNext ? (
        <p className="text-sm text-fg-soft">
          This counter handles {data.nextStep.serviceName} itself. Complete the step and the person
          returns to the line for it — no referral is needed.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-fg-soft">
            Next step: <span className="font-semibold text-fg">{data.nextStep.serviceName}</span>. The
            person will be next at the counter you choose, after whoever it is serving now.
          </p>
          {data.targets.length === 0 ? (
            <p role="status" className="rounded-md bg-subtle px-3 py-2 text-sm text-fg-soft">
              No open counter handles {data.nextStep.serviceName} right now. Complete the step without
              a referral and the person waits in line for it.
            </p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-fg-soft">Refer to</legend>
              {data.targets.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="radio"
                    name={`referral-target-${tokenId}`}
                    value={t.id}
                    checked={target === t.id}
                    onChange={() => setTarget(t.id)}
                  />
                  {t.name}
                  <span className="text-xs text-muted">{t.busy ? 'serving someone now' : 'free now'}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <label htmlFor={`referral-note-${tokenId}`} className="mb-1 block text-sm font-medium text-fg-soft">
              Note for the next counter (optional)
            </label>
            <textarea
              id={`referral-note-${tokenId}`}
              rows={2}
              maxLength={MAX_NOTE}
              value={note}
              aria-invalid={noteError ? true : undefined}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg"
            />
            <p className="mt-1 text-xs text-muted">{noteError ?? `${note.length}/${MAX_NOTE} · Visible to your team only.`}</p>
          </div>
          <ErrorBanner message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={completeToken.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!target || Boolean(noteError)} loading={completeToken.isPending}>
              {completeToken.isPending ? 'Referring…' : 'Complete and refer'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

import { useState, type FormEvent } from 'react';
import { useCounters } from '../hooks/useCounters';
import {
  useCallToken,
  useCompleteToken,
  useRecallToken,
  useSetRequiredDuration,
  useSkipToken,
  useStartToken,
} from '../hooks/useTokenActions';
import { PermissionGate } from './PermissionGate';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { ApiError } from '../api/client';
import type { TokenStatus } from '../types/token';

/**
 * Spec section 10: Call/Start/Complete/Skip, each appearing only when valid
 * for the token's current state (mirrors the backend's centralized state
 * machine — WAITING->{CALLED,SKIPPED}, CALLED->{IN_PROGRESS,SKIPPED},
 * IN_PROGRESS->{COMPLETED,SKIPPED}, SKIPPED->{CALLED} via Recall — never
 * re-implemented here, just read off `status`).
 *
 * V2 Checkpoint 3 (ADR-025): a WAITING row's `position` (already computed
 * server-side, reused as-is — no new field) determines whether "Call" is
 * shown at all — position 1 is the sole FCFS-eligible token; every other
 * WAITING row shows a disabled "Locked" indicator instead. This is purely
 * informative UI: the backend (`callToken`'s FCFS check) is what actually
 * enforces order, regardless of what this component renders. `position`
 * is optional and defaults to "eligible" when omitted, so every existing
 * caller/test that doesn't pass it keeps its prior behavior unchanged.
 *
 * V2 Checkpoint 4 (ADR-026): CALLED/IN_PROGRESS rows also get an "Adjust
 * Time" action (PATCH /api/tokens/:tokenId/duration) — staff overriding an
 * active customer's required duration, which the backend then uses to
 * recompute every WAITING token's ETA in the queue.
 */
export function TokenActions({
  tokenId,
  queueId,
  status,
  position,
}: {
  tokenId: string;
  queueId: string;
  status: TokenStatus;
  position?: number | null;
}) {
  const isFcfsEligible = position == null || position === 1;
  const [pickingCounter, setPickingCounter] = useState(false);
  const [pickingRecallCounter, setPickingRecallCounter] = useState(false);
  const [recallError, setRecallError] = useState<string | null>(null);
  const [adjustingDuration, setAdjustingDuration] = useState(false);
  const [durationInput, setDurationInput] = useState('');
  const [durationError, setDurationError] = useState<string | null>(null);
  // V2 Checkpoint 7 (ADR-029): Start no longer immediately starts service —
  // staff must ask the customer for their verification code first.
  const [startingService, setStartingService] = useState(false);
  const [verificationCodeInput, setVerificationCodeInput] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const { data: counters } = useCounters(pickingCounter || pickingRecallCounter ? queueId : undefined);
  const callToken = useCallToken();
  const startToken = useStartToken();
  const completeToken = useCompleteToken();
  const skipToken = useSkipToken();
  const recallToken = useRecallToken();
  const setRequiredDuration = useSetRequiredDuration();

  function handleDurationSubmit(e: FormEvent) {
    e.preventDefault();
    const requiredDurationMinutes = Number(durationInput);
    if (!Number.isInteger(requiredDurationMinutes) || requiredDurationMinutes <= 0) {
      setDurationError('Enter a whole number of minutes greater than zero.');
      return;
    }
    setDurationError(null);
    setRequiredDuration.mutate(
      { tokenId, requiredDurationMinutes },
      {
        onSuccess: () => {
          setAdjustingDuration(false);
          setDurationInput('');
        },
        onError: (err) =>
          setDurationError(err instanceof ApiError ? err.message : 'Failed to update required time.'),
      },
    );
  }

  function handleStartSubmit(e: FormEvent) {
    e.preventDefault();
    setStartError(null);
    startToken.mutate(
      { tokenId, verificationCode: verificationCodeInput.trim() },
      {
        onSuccess: () => {
          setStartingService(false);
          setVerificationCodeInput('');
        },
        onError: (err) =>
          setStartError(err instanceof ApiError ? err.message : 'Failed to start service.'),
      },
    );
  }

  const activeCounters = (counters ?? []).filter((c) => c.status === 'ACTIVE');

  return (
    <PermissionGate permission="operate_tokens">
      <div className="flex flex-wrap items-center gap-1">
        {status === 'WAITING' && !pickingCounter && isFcfsEligible && (
          <Button variant="primary" onClick={() => setPickingCounter(true)}>
            Call
          </Button>
        )}
        {status === 'WAITING' && !isFcfsEligible && (
          <Button variant="secondary" disabled title="An earlier customer must be called first">
            Locked
          </Button>
        )}
        {status === 'WAITING' && pickingCounter && (
          <select
            autoFocus
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            defaultValue=""
            onBlur={() => setPickingCounter(false)}
            onChange={(e) => {
              if (e.target.value) {
                callToken.mutate({ tokenId, counterId: e.target.value });
              }
              setPickingCounter(false);
            }}
          >
            <option value="" disabled>
              Select counter…
            </option>
            {activeCounters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {status === 'CALLED' && !startingService && (
          <Button
            variant="primary"
            onClick={() => {
              setStartError(null);
              setStartingService(true);
            }}
          >
            Start
          </Button>
        )}
        {status === 'CALLED' && startingService && (
          <form onSubmit={handleStartSubmit} className="flex items-center gap-1">
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              placeholder="Verification code"
              value={verificationCodeInput}
              onChange={(e) => setVerificationCodeInput(e.target.value)}
              className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <Button type="submit" variant="primary" disabled={startToken.isPending}>
              Confirm
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStartingService(false);
                setStartError(null);
                setVerificationCodeInput('');
              }}
            >
              Cancel
            </Button>
          </form>
        )}
        {status === 'IN_PROGRESS' && (
          <Button variant="primary" onClick={() => completeToken.mutate(tokenId)}>
            Complete
          </Button>
        )}
        {(status === 'CALLED' || status === 'IN_PROGRESS') && !adjustingDuration && (
          <Button
            variant="secondary"
            onClick={() => {
              setDurationError(null);
              setAdjustingDuration(true);
            }}
          >
            Adjust Time
          </Button>
        )}
        {(status === 'CALLED' || status === 'IN_PROGRESS') && adjustingDuration && (
          <form onSubmit={handleDurationSubmit} className="flex items-center gap-1">
            <input
              autoFocus
              type="number"
              min={1}
              step={1}
              placeholder="Minutes"
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <Button type="submit" variant="primary" disabled={setRequiredDuration.isPending}>
              Set
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdjustingDuration(false);
                setDurationError(null);
              }}
            >
              Cancel
            </Button>
          </form>
        )}
        {(status === 'WAITING' || status === 'CALLED' || status === 'IN_PROGRESS') && (
          <Button variant="secondary" onClick={() => skipToken.mutate(tokenId)}>
            Skip
          </Button>
        )}
        {status === 'SKIPPED' && !pickingRecallCounter && (
          <Button variant="primary" onClick={() => setPickingRecallCounter(true)}>
            Recall
          </Button>
        )}
        {status === 'SKIPPED' && pickingRecallCounter && (
          <select
            autoFocus
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            defaultValue=""
            onBlur={() => setPickingRecallCounter(false)}
            onChange={(e) => {
              if (e.target.value) {
                setRecallError(null);
                recallToken.mutate(
                  { tokenId, counterId: e.target.value },
                  {
                    onError: (err) =>
                      setRecallError(err instanceof ApiError ? err.message : 'Failed to recall token.'),
                  },
                );
              }
              setPickingRecallCounter(false);
            }}
          >
            <option value="" disabled>
              Select counter…
            </option>
            {activeCounters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {recallError && (
        <div className="mt-1 max-w-xs">
          <ErrorBanner message={recallError} />
        </div>
      )}
      {startError && (
        <div className="mt-1 max-w-xs">
          <ErrorBanner message={startError} />
        </div>
      )}
      {durationError && (
        <div className="mt-1 max-w-xs">
          <ErrorBanner message={durationError} />
        </div>
      )}
    </PermissionGate>
  );
}

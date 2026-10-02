import { useState, type FormEvent } from 'react';
import { useMyCounter } from '../hooks/useCounters';
import { useAuth } from '../context/AuthContext';
import {
  useCompleteToken,
  useSetRequiredDuration,
  useStartToken,
} from '../hooks/useTokenActions';
import { PermissionGate } from './PermissionGate';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { SkipTokenDialog } from './SkipTokenDialog';
import { CompleteWithFeedbackDialog } from './CompleteWithFeedbackDialog';
import { actionErrorMessage } from '../utils/actionError';
import { ApiError } from '../api/client';
import type { TokenStatus } from '../types/token';
import type { WaitingActionEligibility } from '../types/dashboard';

/**
 * Spec section 10: Call/Start/Complete/Skip, each appearing only when valid
 * for the token's current state (mirrors the backend's centralized state
 * machine — WAITING->{CALLED,SKIPPED}, CALLED->{IN_PROGRESS,SKIPPED},
 * IN_PROGRESS->{COMPLETED,SKIPPED} — never re-implemented here, just read
 * off `status`). SKIPPED is terminal — there is no action to take on a
 * skipped token here any more; the customer must scan the queue QR again
 * for a new one (V2 UX + Token Lifecycle checkpoint, Part B: Recall
 * removed).
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
 *
 * ADR-064: there is no per-row Call and no counter or staff picker. People
 * are claimed only through "Serve next" (ServeNextPanel), which takes the
 * next eligible person for the signed-in person at their own counter. A
 * person already at a counter is acted on by whoever stands there; STAFF see
 * no actions for someone at another counter, while OWNER and ADMIN may
 * resolve any of them. The backend enforces all of this regardless.
 *
 * ADR-041: `requiresVerificationCode` is the queue's service-start setting.
 * When false, Start starts service in one click and no code input exists.
 * Defaults to true, so a caller that does not pass it can never quietly
 * drop the verified flow — and the backend decides regardless.
 */
export function TokenActions({
  tokenId,
  queueId,
  status,
  position,
  actionEligibility,
  requiresVerificationCode = true,
  counterId = null,
}: {
  tokenId: string;
  queueId: string;
  /** The counter this person is at, once claimed. */
  counterId?: string | null;
  status: TokenStatus;
  position?: number | null;
  actionEligibility?: WaitingActionEligibility | null;
  requiresVerificationCode?: boolean;
}) {
  // Call and Skip unlock together, always. The backend decides this — the
  // row carries its answer — and a locked row must never show a live Skip,
  // which would let staff drop a later customer ahead of their turn.
  // Falls back to the position rule when a caller has not been updated to
  // pass eligibility, so nothing regresses to "unlocked by default".
  const eligibility: WaitingActionEligibility =
    actionEligibility ??
    (position == null || position === 1
      ? { eligible: true, reason: null }
      : { eligible: false, reason: 'EARLIER_WAITING' });
  const isFcfsEligible = eligibility.eligible;
  const lockedTitle =
    eligibility.reason === 'SESSION_NOT_STARTED'
      ? "This customer's assigned session has not started yet."
      : eligibility.reason === 'NO_AVAILABLE_COUNTER'
        ? 'Waiting for an available counter.'
        : 'Earlier customers must be handled first.';
  const [adjustingDuration, setAdjustingDuration] = useState(false);
  const [durationInput, setDurationInput] = useState('');
  const [durationError, setDurationError] = useState<string | null>(null);
  // V2 Checkpoint 7 (ADR-029): Start no longer immediately starts service —
  // staff must ask the customer for their verification code first.
  const [startingService, setStartingService] = useState(false);
  const [verificationCodeInput, setVerificationCodeInput] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const { hasPermission } = useAuth();
  const { data: myCounter } = useMyCounter();
  // OWNER and ADMIN supervise every counter; STAFF act only at their own.
  const supervises = hasPermission('manage_staff');
  const mayActHere = counterId
    ? supervises || myCounter?.id === counterId
    : supervises || myCounter?.queueId === queueId;
  const startToken = useStartToken();
  const completeToken = useCompleteToken();
  const setRequiredDuration = useSetRequiredDuration();
  const [skipping, setSkipping] = useState(false);
  const [completingWithFeedback, setCompletingWithFeedback] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  function handleComplete() {
    setCompleteError(null);
    completeToken.mutate({ tokenId }, { onError: (err) => setCompleteError(actionErrorMessage(err)) });
  }

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

  /** ADR-041: a queue without the code starts in one click. If the setting
   * was switched back on meanwhile, the backend refuses and says so — that
   * message is shown as-is, and the refreshed row then asks for the code. */
  function handleDirectStart() {
    setStartError(null);
    startToken.mutate(
      { tokenId },
      {
        onError: (err) =>
          setStartError(err instanceof ApiError ? err.message : 'Failed to start service.'),
      },
    );
  }

  return (
    <PermissionGate permission="operate_tokens">
      <div className="flex flex-wrap items-center gap-1">
        {status === 'WAITING' && !isFcfsEligible && (
          <Button variant="secondary" disabled title={lockedTitle}>
            {eligibility.reason === 'SESSION_NOT_STARTED' ? 'Scheduled' : 'Locked'}
          </Button>
        )}
        {!mayActHere && status !== 'WAITING' && (
          <span className="text-xs font-medium text-muted">At another counter</span>
        )}
        {mayActHere && (
          <>
            {status === 'CALLED' && !requiresVerificationCode && (
              <Button variant="primary" size="lg" loading={startToken.isPending} onClick={handleDirectStart}>
                {startToken.isPending ? 'Starting…' : 'Start'}
              </Button>
            )}
            {status === 'CALLED' && requiresVerificationCode && !startingService && (
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  setStartError(null);
                  setStartingService(true);
                }}
              >
                Start
              </Button>
            )}
            {status === 'CALLED' && requiresVerificationCode && startingService && (
              <form onSubmit={handleStartSubmit} className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  placeholder="Verification code"
                  value={verificationCodeInput}
                  onChange={(e) => setVerificationCodeInput(e.target.value)}
                  className="w-36 h-9 rounded-md border border-border-strong px-3 text-sm"
                />
                <Button type="submit" variant="primary" size="lg" loading={startToken.isPending}>
                  {startToken.isPending ? 'Starting…' : 'Confirm'}
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
            {/* ADR-042: Complete stays one click. Feedback is the separate,
                optional path — never a step added in front of Complete. */}
            {status === 'IN_PROGRESS' && (
              <Button variant="primary" size="lg" loading={completeToken.isPending} onClick={handleComplete}>
                {completeToken.isPending ? 'Completing…' : 'Complete'}
              </Button>
            )}
            {status === 'IN_PROGRESS' && (
              <Button variant="secondary" size="lg" onClick={() => setCompletingWithFeedback(true)}>
                Feedback
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
                  className="w-20 h-9 rounded-md border border-border-strong px-3 text-sm"
                />
                <Button type="submit" variant="primary" loading={setRequiredDuration.isPending}>
                  {setRequiredDuration.isPending ? 'Updating…' : 'Set'}
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
            {/* A waiting customer may only be skipped while they could also be
                called; once at a counter, Skip is always available. The single
                "Locked" chip above already explains a locked waiting row, so no
                second disabled button is rendered beside it. */}
            {/* ADR-042: Skip asks why before anything happens — the reason is
                what the customer will read. */}
            {((status === 'WAITING' && isFcfsEligible) ||
              status === 'CALLED' ||
              status === 'IN_PROGRESS') && (
              <Button variant="outline" size="lg" onClick={() => setSkipping(true)}>
                Skip
              </Button>
            )}
          </>
        )}
      </div>
      {skipping && <SkipTokenDialog tokenId={tokenId} onClose={() => setSkipping(false)} />}
      {completingWithFeedback && (
        <CompleteWithFeedbackDialog tokenId={tokenId} onClose={() => setCompletingWithFeedback(false)} />
      )}
      {startError && (
        <div className="mt-1 max-w-xs">
          <ErrorBanner message={startError} />
        </div>
      )}
      {completeError && (
        <div className="mt-1 max-w-xs">
          <ErrorBanner message={completeError} />
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

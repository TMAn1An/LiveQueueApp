import { useState } from 'react';
import { useCounters } from '../hooks/useCounters';
import { useCallToken, useCompleteToken, useSkipToken, useStartToken } from '../hooks/useTokenActions';
import { PermissionGate } from './PermissionGate';
import { Button } from './Button';
import type { TokenStatus } from '../types/token';

/**
 * Spec section 10: Call/Start/Complete/Skip, each appearing only when valid
 * for the token's current state (mirrors the backend's centralized state
 * machine — WAITING->{CALLED,SKIPPED}, CALLED->{IN_PROGRESS,SKIPPED},
 * IN_PROGRESS->{COMPLETED,SKIPPED} — never re-implemented here, just read
 * off `status`).
 */
export function TokenActions({
  tokenId,
  queueId,
  status,
}: {
  tokenId: string;
  queueId: string;
  status: TokenStatus;
}) {
  const [pickingCounter, setPickingCounter] = useState(false);
  const { data: counters } = useCounters(pickingCounter ? queueId : undefined);
  const callToken = useCallToken();
  const startToken = useStartToken();
  const completeToken = useCompleteToken();
  const skipToken = useSkipToken();

  const activeCounters = (counters ?? []).filter((c) => c.status === 'ACTIVE');

  return (
    <PermissionGate permission="operate_tokens">
      <div className="flex flex-wrap items-center gap-1">
        {status === 'WAITING' && !pickingCounter && (
          <Button variant="primary" onClick={() => setPickingCounter(true)}>
            Call
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
        {status === 'CALLED' && (
          <Button variant="primary" onClick={() => startToken.mutate(tokenId)}>
            Start
          </Button>
        )}
        {status === 'IN_PROGRESS' && (
          <Button variant="primary" onClick={() => completeToken.mutate(tokenId)}>
            Complete
          </Button>
        )}
        {(status === 'WAITING' || status === 'CALLED' || status === 'IN_PROGRESS') && (
          <Button variant="secondary" onClick={() => skipToken.mutate(tokenId)}>
            Skip
          </Button>
        )}
      </div>
    </PermissionGate>
  );
}

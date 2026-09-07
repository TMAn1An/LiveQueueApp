import type { TokenStatus } from './token';
import type { DisplayFormField } from './device';

export interface DashboardStats {
  activeQueues: number;
  waitingTokens: number;
  calledTokens: number;
  activeCounters: number;
  countersOnBreak: number;
  averageWaitTimeMinutes: number | null;
  averageServiceTimeMinutes: number | null;
  completedToday: number;
  skippedToday: number;
}

/** Why a waiting customer cannot be acted on yet. Both are operational
 * facts staff can do something about, not internal detail. */
export type WaitingActionBlockedReason = 'EARLIER_WAITING' | 'NO_AVAILABLE_COUNTER';

/**
 * The backend's own answer to "can this waiting customer be called or
 * skipped right now" — the two actions unlock together, so the dashboard
 * reads one verdict rather than deriving two rules of its own.
 */
export interface WaitingActionEligibility {
  eligible: boolean;
  reason: WaitingActionBlockedReason | null;
}

export interface LiveQueueTokenRow {
  id: string;
  serialNumber: string;
  status: TokenStatus;
  queue: { id: string; name: string };
  /** V2 Checkpoint 5 (ADR-027): the full multi-service selection. */
  services: { id: string; name: string }[];
  counter: { id: string; name: string } | null;
  position: number | null;
  estimatedWaitMinutes: number | null;
  /** Null for rows that are not WAITING, where the concept does not apply. */
  actionEligibility: WaitingActionEligibility | null;
  createdAt: string;
  calledAt: string | null;
  startedAt: string | null;
  deviceId: string;
  formFields: DisplayFormField[];
}

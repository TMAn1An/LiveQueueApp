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

/** Why a waiting customer cannot be acted on yet — operational facts, not
 * internal detail. SESSION_NOT_STARTED (ADR-048): the customer was assigned
 * a later session today and joins the line when it starts. */
export type WaitingActionBlockedReason = 'SESSION_NOT_STARTED' | 'EARLIER_WAITING' | 'NO_AVAILABLE_COUNTER';

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
  /** requireServiceStartOtp (ADR-041) decides whether Start asks for the
   * customer's code on this row — display only; the API re-decides. */
  queue: { id: string; name: string; requireServiceStartOtp: boolean };
  /** V2 Checkpoint 5 (ADR-027): the full multi-service selection. */
  services: { id: string; name: string }[];
  counter: { id: string; name: string } | null;
  position: number | null;
  estimatedWaitMinutes: number | null;
  /** Null for rows that are not WAITING, where the concept does not apply. */
  actionEligibility: WaitingActionEligibility | null;
  /** The token's fixed session assignment on a scheduled queue (ADR-046/048);
   * null on an unscheduled queue. Minutes are on the queue's own clock. */
  assignedSession?: { startMinute: number; endMinute: number; startsAt: string | null } | null;
  createdAt: string;
  calledAt: string | null;
  startedAt: string | null;
  deviceId: string;
  formFields: DisplayFormField[];
}

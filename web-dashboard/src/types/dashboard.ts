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
  createdAt: string;
  calledAt: string | null;
  startedAt: string | null;
  deviceId: string;
  formFields: DisplayFormField[];
}

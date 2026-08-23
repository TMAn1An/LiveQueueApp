import type { TokenStatus } from './token';

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
  service: { id: string; name: string };
  counter: { id: string; name: string } | null;
  position: number | null;
  estimatedWaitMinutes: number | null;
  createdAt: string;
  calledAt: string | null;
  startedAt: string | null;
}

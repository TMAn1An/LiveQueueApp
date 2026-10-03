export type ReportRangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export interface PeakHourEntry {
  hour: number;
  count: number;
}

export interface CounterUtilizationEntry {
  counterId: string;
  counterName: string;
  tokensServed: number;
  utilizationPercent: number;
}

export interface QueuePerformanceEntry {
  queueId: string;
  queueName: string;
  created: number;
  completed: number;
  skipped: number;
  averageWaitMinutes: number | null;
}

export interface Report {
  range: { from: string; to: string };
  tokensCreated: number;
  tokensCompleted: number;
  tokensSkipped: number;
  averageWaitingTimeMinutes: number | null;
  averageServiceDurationMinutes: number | null;
  peakHours: PeakHourEntry[];
  counterUtilization: CounterUtilizationEntry[];
  queuePerformance: QueuePerformanceEntry[];
  /** ADR-070: per service, completed journey steps and their average length. */
  serviceSteps?: { serviceId: string; serviceName: string; stepsCompleted: number; averageStepMinutes: number | null }[];
  /** ADR-070: referrals between counters. */
  referrals?: { fromCounterName: string | null; toCounterName: string | null; referrals: number }[];
}

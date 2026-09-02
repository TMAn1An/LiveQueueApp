export type TokenStatus = 'WAITING' | 'CALLED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

/** Staff-authorized view (token.service.ts toStaffView) — includes organizationId/deviceId. */
export interface StaffToken {
  id: string;
  organizationId: string;
  queueId: string;
  /** LEGACY — the first selected service (V2 Checkpoint 5, ADR-027). */
  serviceId: string;
  /** The authoritative, complete multi-service selection. */
  services: { id: string; name: string; durationMinutes: number }[];
  counterId: string | null;
  deviceId: string;
  sequenceNumber: number;
  serialNumber: string;
  status: TokenStatus;
  formData: Record<string, unknown>;
  formVersion: number;
  position: number | null;
  estimatedWaitMinutes: number | null;
  /** V2 Checkpoint 4 (ADR-026) — server-authoritative anchor for a live countdown. */
  estimatedReadyAt: string | null;
  /** V2 Checkpoint 4 (ADR-026) — staff override; null means "use the service's own duration." */
  requiredDurationMinutes: number | null;
  createdAt: string;
  calledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
}

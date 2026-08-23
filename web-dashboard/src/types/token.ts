export type TokenStatus = 'WAITING' | 'CALLED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

/** Staff-authorized view (token.service.ts toStaffView) — includes organizationId/deviceId. */
export interface StaffToken {
  id: string;
  organizationId: string;
  queueId: string;
  serviceId: string;
  counterId: string | null;
  deviceId: string;
  sequenceNumber: number;
  serialNumber: string;
  status: TokenStatus;
  formData: Record<string, unknown>;
  formVersion: number;
  position: number | null;
  estimatedWaitMinutes: number | null;
  createdAt: string;
  calledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
}

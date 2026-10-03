import { getApiBaseUrl } from '../api/client';
import { newUuid } from './installation';

/**
 * ADR-068: the portal's calls — all public, unauthenticated endpoints shared
 * with the Android app. The backend decides everything (joinability, rules,
 * positions); the portal only shows what it is told.
 */

export class PortalApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new PortalApiError(0, 'NETWORK_ERROR', 'Could not reach LiveQueue. Check your connection and try again.');
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: { code: string; message: string } }
    | null;
  if (!response.ok || !body || body.success === false) {
    const error = body && body.success === false ? body.error : null;
    throw new PortalApiError(response.status, error?.code ?? 'ERROR', error?.message ?? 'Something went wrong. Please try again.');
  }
  return body.data;
}

export interface PortalQueue {
  id: string;
  name: string;
  description: string | null;
  availability: 'JOINABLE' | 'CLOSED';
  closedReason: 'PAUSED' | 'INACTIVE' | 'SCHEDULE' | 'NOT_READY' | null;
  message: string | null;
  waitingCount: number;
  estimatedWaitMinutes: number | null;
  timezone: string | null;
  todaySessions: { startMinute: number; endMinute: number }[] | null;
  nextSessionStartMinute: number | null;
}

export interface PortalOrganization {
  organization: { name: string; publicCode: string };
  queues: PortalQueue[];
}

export interface FormField {
  id: string;
  key: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'phone' | 'date' | 'dropdown' | 'radio' | 'checkbox';
  required: boolean;
  placeholder: string | null;
  options: string[];
}

export interface QueueConfig {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'INACTIVE';
  allowMultipleServices: boolean;
  identity: { requiresVerifiedEmail: boolean; configurationRequired: boolean; repeatRestricted: boolean };
  schedule: { acceptingJoins: boolean; message: string | null };
  services: { id: string; serviceName: string; description: string | null; durationMinutes: number }[];
  formFields: FormField[];
}

export type TokenStatus = 'WAITING' | 'CALLED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';

export interface PortalToken {
  id: string;
  queueId: string;
  serialNumber: string;
  status: TokenStatus;
  position: number | null;
  estimatedWaitMinutes: number | null;
  etaUnavailableReason: string | null;
  counter: { id: string; name: string } | null;
  services: { id: string; serviceName: string }[];
  serviceStartVerificationRequired: boolean;
  skipReason?: { code: string; text: string | null } | null;
  completionFeedback?: string | null;
}

export const portalApi = {
  organization: (code: string) => request<PortalOrganization>(`/api/public/organizations/${encodeURIComponent(code)}`),
  queueConfig: (queueId: string) => request<QueueConfig>(`/api/public/queues/${encodeURIComponent(queueId)}/config`),
  startEmailVerification: (queueId: string, email: string) =>
    request<{ verificationId: string }>('/api/public/email-verification/start', {
      method: 'POST',
      body: JSON.stringify({ queueId, email }),
    }),
  confirmEmailVerification: (verificationId: string, code: string, email: string) =>
    request<{ verificationProof: string }>('/api/public/email-verification/confirm', {
      method: 'POST',
      body: JSON.stringify({ verificationId, code, email }),
    }),
  join: (input: {
    queueId: string;
    serviceIds: string[];
    deviceIdentifier: string;
    formData: Record<string, unknown>;
    emailVerificationProof?: string;
    idempotencyKey?: string;
  }) =>
    request<PortalToken>('/api/tokens', {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey ?? newUuid() },
      body: JSON.stringify({
        queueId: input.queueId,
        serviceIds: input.serviceIds,
        deviceIdentifier: input.deviceIdentifier,
        formData: input.formData,
        ...(input.emailVerificationProof ? { emailVerificationProof: input.emailVerificationProof } : {}),
      }),
    }),
  token: (tokenId: string) => request<PortalToken>(`/api/tokens/${encodeURIComponent(tokenId)}`),
  cancel: (tokenId: string, deviceIdentifier: string) =>
    request<PortalToken>(`/api/tokens/${encodeURIComponent(tokenId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ deviceIdentifier }),
    }),
  verificationCode: (tokenId: string, deviceIdentifier: string) =>
    request<{ code: string | null; expiresAt: string | null }>(
      `/api/tokens/${encodeURIComponent(tokenId)}/verification-code?deviceIdentifier=${encodeURIComponent(deviceIdentifier)}`,
    ),
  webPushConfig: () => request<{ enabled: boolean; vapidPublicKey: string | null }>('/api/public/web-push/config'),
  registerWebPush: (deviceIdentifier: string, subscription: PushSubscriptionJSON) =>
    request<unknown>('/api/devices/web-push-subscription', {
      method: 'POST',
      body: JSON.stringify({ deviceIdentifier, subscription }),
    }),
  unregisterWebPush: (deviceIdentifier: string, endpoint: string) =>
    request<void>('/api/devices/web-push-subscription', {
      method: 'DELETE',
      body: JSON.stringify({ deviceIdentifier, endpoint }),
    }),
  setNotifications: (tokenId: string, deviceIdentifier: string, enabled: boolean) =>
    request<unknown>(`/api/tokens/${encodeURIComponent(tokenId)}/notification-preferences`, {
      method: 'PUT',
      body: JSON.stringify({ deviceIdentifier, notificationsEnabled: enabled, reminderMinutes: null }),
    }),
};

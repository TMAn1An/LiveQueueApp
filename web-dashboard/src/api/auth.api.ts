import { apiFetch, getApiBaseUrl } from './client';
import type { AuthResult } from '../types/auth';

export function register(input: {
  organizationName: string;
  email: string;
  password: string;
  /** ADR-035: the browser's zone, which becomes the organization's starting
   * timezone so nobody has to pick one from a list of hundreds. */
  timezone?: string;
}) {
  return apiFetch<AuthResult>('/api/auth/register', { method: 'POST', body: input });
}

/** Live "is this organization name free?" check — case-insensitive. */
export function checkOrganizationNameAvailability(name: string, signal?: AbortSignal) {
  return apiFetch<{ available: boolean }>('/api/auth/organization-name-availability', {
    method: 'GET',
    query: { name },
    signal,
  });
}

/** ADR-058: always answers with the same generic message, whether or not the
 * address belongs to an account. */
export function requestPasswordReset(email: string) {
  return apiFetch<{ message: string }>('/api/auth/password-reset/request', {
    method: 'POST',
    body: { email },
  });
}

/** Read-only: checking a link never uses it up. */
export function validatePasswordResetToken(token: string) {
  return apiFetch<{ valid: boolean }>('/api/auth/password-reset/validate', {
    method: 'GET',
    query: { token },
  });
}

export function resetPassword(token: string, password: string) {
  return apiFetch<{ reset: true }>('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: { token, password },
  });
}

export function login(input: { email: string; password: string }) {
  return apiFetch<AuthResult>('/api/auth/login', { method: 'POST', body: input });
}

export function me() {
  return apiFetch<Omit<AuthResult, 'accessToken' | 'refreshToken'>>('/api/auth/me');
}

const HEALTH_TIMEOUT_MS = 5_000;

/**
 * Deliberately has no timeout of its own. The refresh token is single-use:
 * abandoning a request that the server may still go on to process (a backend
 * that is slow to wake, say) and then sending the token again is how a
 * legitimate client gets itself refused. The browser's own limits apply.
 */
export function refresh(refreshToken: string) {
  return apiFetch<{ accessToken: string; refreshToken: string }>('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
}

/**
 * Whether the backend answers at all. Carries no credentials and changes
 * nothing, so it is safe to repeat as often as needed — unlike the refresh
 * exchange, which spends a single-use token. Used to wait for the server to
 * come back before a session restore is retried.
 */
export async function checkBackendReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${getApiBaseUrl()}/health`, { cache: 'no-store', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function logout(refreshToken: string) {
  return apiFetch<void>('/api/auth/logout', { method: 'POST', body: { refreshToken } });
}

export function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  refreshToken: string;
}) {
  return apiFetch<void>('/api/auth/password', { method: 'PATCH', body: input });
}

export function verifyEmail(token: string) {
  return apiFetch<{ verified: boolean }>('/api/auth/email-verification/verify', {
    method: 'GET',
    query: { token },
  });
}

export function resendVerificationEmail() {
  return apiFetch<void>('/api/auth/email-verification/resend', { method: 'POST' });
}

/** ADR-035: an invited staff member redeems their emailed link. Public — the
 * token is the credential — and returns no session, so signing in stays the
 * one place a session is created. */
/** ADR-071: checked before the password form is shown — only yes or no. */
export function validateInvitation(token: string) {
  return apiFetch<{ valid: boolean }>('/api/auth/invitations/validate', {
    method: 'GET',
    query: { token },
  });
}

export function acceptInvitation(token: string, password: string) {
  return apiFetch<{ email: string }>('/api/auth/accept-invitation', {
    method: 'POST',
    body: { token, password },
  });
}

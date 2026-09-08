import { apiFetch } from './client';
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

export function login(input: { email: string; password: string }) {
  return apiFetch<AuthResult>('/api/auth/login', { method: 'POST', body: input });
}

export function me() {
  return apiFetch<Omit<AuthResult, 'accessToken' | 'refreshToken'>>('/api/auth/me');
}

export function refresh(refreshToken: string) {
  return apiFetch<{ accessToken: string; refreshToken: string }>('/api/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
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
export function acceptInvitation(token: string, password: string) {
  return apiFetch<{ email: string }>('/api/auth/accept-invitation', {
    method: 'POST',
    body: { token, password },
  });
}

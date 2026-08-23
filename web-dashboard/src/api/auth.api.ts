import { apiFetch } from './client';
import type { AuthResult } from '../types/auth';

export function register(input: { organizationName: string; email: string; password: string }) {
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

import { apiFetch } from './client';

/** ADR-071 D10: the fixed handover reasons. */
export type SuccessionReason =
  | 'RETIREMENT'
  | 'RESIGNATION'
  | 'END_OF_TERM'
  | 'ORGANIZATIONAL_RESTRUCTURING'
  | 'CHANGE_OF_RESPONSIBILITY'
  | 'PERSONAL_REASONS'
  | 'OTHER';

export const SUCCESSION_REASONS: { value: SuccessionReason; label: string }[] = [
  { value: 'RETIREMENT', label: 'Retirement' },
  { value: 'RESIGNATION', label: 'Resignation' },
  { value: 'END_OF_TERM', label: 'End of term' },
  { value: 'ORGANIZATIONAL_RESTRUCTURING', label: 'Organizational restructuring' },
  { value: 'CHANGE_OF_RESPONSIBILITY', label: 'Change of responsibility' },
  { value: 'PERSONAL_REASONS', label: 'Personal reasons' },
  { value: 'OTHER', label: 'Other' },
];

export function reasonLabel(reason: SuccessionReason | null | undefined): string {
  return SUCCESSION_REASONS.find((r) => r.value === reason)?.label ?? '';
}

export type SuccessionStatus =
  | 'AWAITING_VERIFICATION'
  | 'AWAITING_ACCEPTANCE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DECLINED'
  | 'EXPIRED';

export interface Succession {
  id: string;
  status: SuccessionStatus;
  successor: { name: string; email: string; existingMember: boolean };
  reason: SuccessionReason;
  note: string | null;
  initiatedBy: { id: string; name: string };
  verificationExpiresAt: string | null;
  attemptsLeft: number;
  successorLinkExpiresAt: string | null;
  verifiedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  createdAt: string;
}

export interface PreviousHead {
  name: string;
  startedAt: string;
  endedAt: string;
  startType: 'FOUNDING' | 'SUCCESSION' | 'BACKFILL';
  reason: SuccessionReason | null;
  /** Organization Head only. */
  note?: string | null;
  email?: string;
}

/** What the server lets this person see (ADR-071 D5): the Head everything,
 * a Manager history without private notes, others the current Head only. */
export interface Leadership {
  current: { name: string; since: string } | null;
  previous: PreviousHead[] | null;
  succession: Succession | null;
}

export function getLeadership() {
  return apiFetch<Leadership>('/api/organizations/me/leadership');
}

export interface StartSuccessionInput {
  successorEmail: string;
  successorName?: string;
  reason: SuccessionReason;
  note?: string;
  currentPassword: string;
}

export function startSuccession(input: StartSuccessionInput) {
  return apiFetch<Succession & { codeEmailSent: boolean }>('/api/organizations/me/leadership-transfers', {
    method: 'POST',
    body: input,
  });
}

export function verifySuccession(id: string, code: string) {
  return apiFetch<Succession & { successorEmailSent: boolean }>(
    `/api/organizations/me/leadership-transfers/${id}/verify`,
    { method: 'POST', body: { code } },
  );
}

export function resendSuccessorLink(id: string) {
  return apiFetch<Succession & { successorEmailSent: boolean }>(
    `/api/organizations/me/leadership-transfers/${id}/resend-link`,
    { method: 'POST' },
  );
}

export function cancelSuccession(id: string) {
  return apiFetch<Succession>(`/api/organizations/me/leadership-transfers/${id}/cancel`, { method: 'POST' });
}

// The successor's side — public; the emailed link is the credential.

export type SuccessorLinkCheck =
  | { valid: false }
  | {
      valid: true;
      organizationName: string;
      currentHeadName: string;
      reason: SuccessionReason;
      successorName: string;
      successorEmail: string;
      existingMember: boolean;
      acceptanceStatement: string;
    };

export function validateSuccessorLink(token: string) {
  return apiFetch<SuccessorLinkCheck>('/api/auth/leadership-handover/validate', { query: { token } });
}

export function acceptSuccession(token: string, password: string) {
  return apiFetch<{ accepted: true; organizationName: string }>('/api/auth/leadership-handover/accept', {
    method: 'POST',
    body: { token, password, acknowledged: true },
  });
}

export function declineSuccession(token: string) {
  return apiFetch<{ declined: true }>('/api/auth/leadership-handover/decline', { method: 'POST', body: { token } });
}

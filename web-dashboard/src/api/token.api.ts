import { apiFetch } from './client';
import type { StaffToken } from '../types/token';
import type { SkipReasonCode } from '../types/terminalNotes';

/** ADR-064: the backend claims at the caller's own counter — no counter or
 * staff member is ever named by the dashboard. */
export function callToken(tokenId: string) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/call`, { method: 'POST', body: {} });
}

// V2 Checkpoint 7 (ADR-029): CALLED -> IN_PROGRESS takes the customer-told
// verification code. ADR-041: only on a queue that uses one — otherwise no
// code is sent at all, and the backend decides either way.
export function startToken(tokenId: string, verificationCode?: string) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/start`, {
    method: 'POST',
    body: verificationCode === undefined ? {} : { verificationCode },
  });
}

// ADR-042: feedback is optional — omitted entirely for an ordinary completion.
// ADR-070: on a journey, completing a step that is not the last sends the
// person back to wait for the next one; `referToCounterId` refers that next
// step to a counter that handles it (the note is optional).
export function completeToken(
  tokenId: string,
  feedback?: string,
  referral?: { referToCounterId: string; referralNote?: string },
) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/complete`, {
    method: 'POST',
    body: {
      ...(feedback === undefined ? {} : { feedback }),
      ...(referral ? { referToCounterId: referral.referToCounterId } : {}),
      ...(referral?.referralNote ? { referralNote: referral.referralNote } : {}),
    },
  });
}

/** ADR-070: the step after the current one, and where it could be referred. */
export interface ReferralOptions {
  nextStep: { stepNumber: number; serviceId: string; serviceName: string } | null;
  currentCounterHandlesNext: boolean;
  targets: { id: string; name: string; busy: boolean }[];
}

export function getReferralOptions(tokenId: string) {
  return apiFetch<ReferralOptions>(`/api/tokens/${tokenId}/referral-options`);
}

// ADR-042: every skip says why. reasonText is only meaningful for OTHER.
export function skipToken(tokenId: string, reasonCode: SkipReasonCode, reasonText?: string) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/skip`, {
    method: 'POST',
    body: reasonText === undefined ? { reasonCode } : { reasonCode, reasonText },
  });
}

/** ADR-064: "Serve next" — the next eligible person, for the caller, at the
 * caller's own counter. */
export function nextToken(queueId: string) {
  return apiFetch<StaffToken>(`/api/queues/${queueId}/next`, { method: 'POST', body: {} });
}

// V2 Checkpoint 4 (ADR-026): staff override of an active customer's
// required service duration, in minutes.
export function setRequiredDuration(tokenId: string, requiredDurationMinutes: number) {
  return apiFetch<StaffToken>(`/api/tokens/${tokenId}/duration`, {
    method: 'PATCH',
    body: { requiredDurationMinutes },
  });
}

/**
 * ADR-042: why staff skipped a customer, and the optional note left on
 * completion. The codes mirror the backend's SkipReasonCode enum; the labels
 * mirror the wording the backend stores and the customer reads.
 */
export type SkipReasonCode =
  | 'CUSTOMER_NOT_PRESENT'
  | 'NO_RESPONSE'
  | 'MISSING_REQUIREMENT'
  | 'CUSTOMER_LEFT'
  | 'OTHER';

export const SKIP_REASON_OPTIONS: { code: SkipReasonCode; label: string }[] = [
  { code: 'CUSTOMER_NOT_PRESENT', label: 'Person not present' },
  { code: 'NO_RESPONSE', label: 'No response from person' },
  { code: 'MISSING_REQUIREMENT', label: 'Required document/information missing' },
  { code: 'CUSTOMER_LEFT', label: 'Person requested to leave' },
  { code: 'OTHER', label: 'Other' },
];

/** Same limits the backend enforces — checked here only so staff find out
 * before submitting, never instead of the backend. */
export const SKIP_REASON_TEXT_MAX_LENGTH = 200;
export const COMPLETION_FEEDBACK_MAX_LENGTH = 500;

/** What a skip reason reads as — the text the backend stored at the time. */
export interface SkipReason {
  code: SkipReasonCode;
  text: string | null;
}

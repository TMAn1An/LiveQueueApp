import type { SkipReasonCode } from '@prisma/client';
import { AppError } from './AppError';

/**
 * ADR-042: why staff skipped a customer, and the optional note staff may
 * leave on completion. Both are operator-typed text that the customer later
 * reads, so both go through the same normalization before being stored.
 */

/** The wording the skipped person reads for each predefined reason. Neutral
 * ("person", not "customer") because not every queue serves customers.
 * Stored as a snapshot on the token at skip time (Token.skipReasonText), so
 * changing a label here never rewrites what an earlier person was told — a
 * token skipped before this wording keeps the text it was given. The codes
 * themselves are stable identifiers and never change. */
export const SKIP_REASON_LABELS: Record<Exclude<SkipReasonCode, 'OTHER'>, string> = {
  CUSTOMER_NOT_PRESENT: 'Person not present',
  NO_RESPONSE: 'No response from person',
  MISSING_REQUIREMENT: 'Required document/information missing',
  CUSTOMER_LEFT: 'Person requested to leave',
};

export const SKIP_REASON_CODES: readonly SkipReasonCode[] = [
  'CUSTOMER_NOT_PRESENT',
  'NO_RESPONSE',
  'MISSING_REQUIREMENT',
  'CUSTOMER_LEFT',
  'OTHER',
];

export const SKIP_REASON_TEXT_MAX_LENGTH = 200;
export const COMPLETION_FEEDBACK_MAX_LENGTH = 500;

/**
 * Operator text a customer will read. Control characters are removed (they
 * have no business in a displayed sentence and can corrupt a notification or
 * a log line); line breaks are kept only where the caller allows them, runs
 * of spaces collapse, and the ends are trimmed. Returns null when nothing
 * readable is left.
 */
export function normalizeOperatorText(
  raw: string,
  { multiline }: { multiline: boolean },
): string | null {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    // Every C0/C1 control character except the line feed kept above.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim());
  const joined = multiline ? lines.join('\n').replace(/\n{3,}/g, '\n\n') : lines.join(' ');
  const text = joined.replace(/ {2,}/g, ' ').trim();
  return text.length > 0 ? text : null;
}

export interface SkipReasonInput {
  reasonCode?: string;
  reasonText?: string;
}

export interface ResolvedSkipReason {
  code: SkipReasonCode;
  text: string;
}

/** The single authority on whether a skip request carries a valid reason. */
export function resolveSkipReason(input: SkipReasonInput): ResolvedSkipReason {
  const rawCode = input.reasonCode?.trim();
  if (!rawCode) {
    throw new AppError(422, 'SKIP_REASON_REQUIRED', 'Choose a reason for skipping this person.');
  }
  if (!SKIP_REASON_CODES.includes(rawCode as SkipReasonCode)) {
    throw new AppError(422, 'INVALID_SKIP_REASON', 'That skip reason is not recognised.');
  }
  const code = rawCode as SkipReasonCode;

  if (code !== 'OTHER') {
    // A predefined reason speaks for itself; any text sent alongside it is
    // not what the reason means and is not stored.
    return { code, text: SKIP_REASON_LABELS[code] };
  }

  const text =
    input.reasonText === undefined
      ? null
      : normalizeOperatorText(input.reasonText, { multiline: false });
  if (!text) {
    throw new AppError(
      422,
      'SKIP_REASON_TEXT_REQUIRED',
      'Describe the reason for skipping this person.',
    );
  }
  if (text.length > SKIP_REASON_TEXT_MAX_LENGTH) {
    throw new AppError(
      422,
      'SKIP_REASON_TEXT_TOO_LONG',
      `Keep the skip reason under ${SKIP_REASON_TEXT_MAX_LENGTH} characters.`,
    );
  }
  return { code, text };
}

/** Optional completion feedback: blank means an ordinary completion. */
export function resolveCompletionFeedback(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const text = normalizeOperatorText(raw, { multiline: true });
  if (text && text.length > COMPLETION_FEEDBACK_MAX_LENGTH) {
    throw new AppError(
      422,
      'COMPLETION_FEEDBACK_TOO_LONG',
      `Keep the feedback under ${COMPLETION_FEEDBACK_MAX_LENGTH} characters.`,
    );
  }
  return text;
}

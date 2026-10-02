/**
 * ADR-056: names and descriptions are English/Latin script only. A copy of
 * backend/src/validators/latinText.ts — the backend is what enforces it; this
 * copy only lets a form flag the problem while someone types. Keep the
 * patterns identical (both are covered by tests).
 *
 * NAME: organization, queue, service, counter and staff names, and the
 * customer terminology word.
 * TEXT: descriptions, form-field labels, placeholders, dropdown options and
 * request notes — any printable ASCII plus line breaks.
 */
export const LATIN_NAME_PATTERN = /^[A-Za-z0-9 .,\-_'()/&:+]*$/;
export const LATIN_TEXT_PATTERN = /^[\x20-\x7E\r\n\t]*$/;

export const LATIN_NAME_MESSAGE =
  "Use English letters (A-Z), numbers, spaces and . , - _ ' ( ) / & : + only.";
export const LATIN_TEXT_MESSAGE = 'Use English letters, numbers and standard punctuation only.';

/** The message to show for a name field, or null when it is fine. */
export function latinNameError(value: string): string | null {
  return LATIN_NAME_PATTERN.test(value) ? null : LATIN_NAME_MESSAGE;
}

/** The message to show for a free-text field, or null when it is fine. */
export function latinTextError(value: string): string | null {
  return LATIN_TEXT_PATTERN.test(value) ? null : LATIN_TEXT_MESSAGE;
}

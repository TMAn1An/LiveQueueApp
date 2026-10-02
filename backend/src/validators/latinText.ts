/**
 * ADR-056: human-entered names and descriptions are English/Latin script only.
 *
 * Two levels, chosen per field (the full field list is in ADR-056):
 *
 * - NAME — organization, queue, service, counter and staff names, and the
 *   customer terminology word. ASCII letters, digits, spaces and the
 *   punctuation a name or label plausibly needs: . , - _ ' ( ) / & : +
 * - TEXT — descriptions, form-field labels, placeholders and dropdown options.
 *   Any printable ASCII character plus line breaks, so a question can end in
 *   "?" and a description can have paragraphs, while still refusing every
 *   non-Latin script (Bengali, Arabic, CJK, Cyrillic, Devanagari, …) and
 *   emoji.
 *
 * Never applied to emails, tokens, codes, ids, URLs, search terms or anything
 * a customer types into a queue form. Text is rejected, never stripped: a
 * silently altered name is worse than a clear error.
 *
 * The dashboard holds a copy of these patterns
 * (web-dashboard/src/utils/latinText.ts) so it can flag a character as it is
 * typed. Keep the two identical; both are covered by tests.
 */
export const LATIN_NAME_PATTERN = /^[A-Za-z0-9 .,\-_'()/&:+]*$/;
export const LATIN_TEXT_PATTERN = /^[\x20-\x7E\r\n\t]*$/;

export const LATIN_NAME_MESSAGE =
  "Use English letters (A-Z), numbers, spaces and . , - _ ' ( ) / & : + only.";
export const LATIN_TEXT_MESSAGE = 'Use English letters, numbers and standard punctuation only.';

export const isLatinName = (value: string): boolean => LATIN_NAME_PATTERN.test(value);
export const isLatinText = (value: string): boolean => LATIN_TEXT_PATTERN.test(value);

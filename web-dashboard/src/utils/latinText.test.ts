import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LATIN_NAME_MESSAGE,
  LATIN_NAME_PATTERN,
  LATIN_TEXT_MESSAGE,
  LATIN_TEXT_PATTERN,
  latinNameError,
  latinTextError,
} from './latinText';

const NON_LATIN = ['ঢাকা', 'عيادة', '诊所', 'Клиника', 'क्लिनिक', 'Clinic 😀', 'Café'];

describe('ADR-056 — Latin-only text (dashboard copy)', () => {
  it('accepts names with the allowed punctuation', () => {
    for (const ok of ['Main Hall', "O'Brien & Sons, Ltd.", 'Lab: X-Ray / Scan + Report', 'Desk (2)_b']) {
      expect(latinNameError(ok)).toBeNull();
    }
  });

  it('rejects every non-Latin script in names and text, with a clear message', () => {
    for (const bad of NON_LATIN) {
      expect(latinNameError(bad)).toBe(LATIN_NAME_MESSAGE);
      expect(latinTextError(bad)).toBe(LATIN_TEXT_MESSAGE);
    }
    expect(latinNameError('Who?')).toBe(LATIN_NAME_MESSAGE);
  });

  it('lets free text use any ASCII punctuation and line breaks', () => {
    expect(latinTextError('Age? (years)\nBring ID! 100% #1')).toBeNull();
  });

  it('is byte-for-byte the same rule the backend enforces', () => {
    const backend = readFileSync(
      resolve(__dirname, '../../../backend/src/validators/latinText.ts'),
      'utf8',
    );
    expect(backend).toContain(`export const LATIN_NAME_PATTERN = ${LATIN_NAME_PATTERN.toString()};`);
    expect(backend).toContain(`export const LATIN_TEXT_PATTERN = ${LATIN_TEXT_PATTERN.toString()};`);
    expect(backend).toContain(JSON.stringify(LATIN_TEXT_MESSAGE).slice(1, -1));
  });
});

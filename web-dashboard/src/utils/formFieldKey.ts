/**
 * ADR-065: the form builder's one key rule — the same normalisation the
 * builder has always used (lower-case, anything but a–z, 0–9 and "_" becomes
 * "_", at most 32 characters), applied to the trimmed label. Saved labels are
 * already trimmed by the backend, so every key this produced before still
 * comes out the same.
 */
export const FIELD_KEY_MAX_LENGTH = 32;

export function fieldKeyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, FIELD_KEY_MAX_LENGTH);
}

/** Mirrors the backend's key rule (formField.validators.ts). */
export const FIELD_KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

export interface FieldKeyState {
  label: string;
  key: string;
  /** True once someone has typed a key themselves; the label stops driving it. */
  keyManual: boolean;
}

/**
 * The label changed. An auto-managed key follows it; a key someone typed is
 * left alone. A blank label always clears the key and hands it back to the
 * label, so a row can never keep a key for a label that no longer exists.
 */
export function withLabel<T extends FieldKeyState>(field: T, label: string): T {
  if (label.trim() === '') {
    return { ...field, label, key: '', keyManual: false };
  }
  return field.keyManual ? { ...field, label } : { ...field, label, key: fieldKeyFromLabel(label) };
}

/**
 * The key was edited by hand, so it is no longer driven by the label —
 * unless it was emptied, which hands it back.
 */
export function withKey<T extends FieldKeyState>(field: T, key: string): T {
  return { ...field, key, keyManual: key !== '' };
}

/** Why this row's key cannot be saved, or null. */
export function fieldKeyError(field: FieldKeyState, duplicate: boolean): string | null {
  if (field.label.trim() === '') return null; // the label's own error covers the row
  if (field.key === '') return 'Enter a key for this field.';
  if (!FIELD_KEY_PATTERN.test(field.key)) return 'Use only letters, numbers and underscores.';
  if (duplicate) return 'Another field already uses this key.';
  return null;
}

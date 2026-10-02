import { useEffect, useState } from 'react';
import { useFormFields, useReplaceFormFields } from '../hooks/useFormFields';
import { Button } from './Button';
import { FieldError } from './FieldError';
import { InfoHelp } from './InfoHelp';
import { latinTextError } from '../utils/latinText';
import { fieldKeyError, withKey, withLabel } from '../utils/formFieldKey';
import { PermissionGate } from './PermissionGate';
import { ErrorBanner } from './ErrorBanner';
import { ApiError } from '../api/client';
import type { FormFieldInput } from '../api/formField.api';
import type { FormFieldType, QueueFormField } from '../types/queue';

const FIELD_TYPES: FormFieldType[] = [
  'text',
  'number',
  'email',
  'phone',
  'date',
  'dropdown',
  'radio',
  'checkbox',
];

const OPTION_TYPES: FormFieldType[] = ['dropdown', 'radio'];

const fieldInputClass =
  'h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg focus:border-brand-500';

/**
 * One row of the builder. Everything that belongs to a field — its label,
 * key, type, options and whether its key was typed by hand — lives on this
 * object, so removing the row removes all of it (ADR-065).
 */
interface EditableField extends FormFieldInput {
  _localId: string;
  /** The key was typed by hand (or the field was saved before), so label
   * edits leave it alone. */
  keyManual: boolean;
}

function duplicateKeys(fields: EditableField[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const f of fields) {
    if (!f.key) continue;
    if (seen.has(f.key)) duplicates.add(f.key);
    seen.add(f.key);
  }
  return duplicates;
}

function optionsError(field: FormFieldInput): string | null {
  if (!OPTION_TYPES.includes(field.type)) return null;
  return (field.options ?? []).map(latinTextError).find(Boolean) ?? null;
}

function toEditable(fields: QueueFormField[]): EditableField[] {
  return fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    placeholder: f.placeholder ?? undefined,
    options: f.options,
    sortOrder: f.sortOrder,
    _localId: crypto.randomUUID(),
    // A saved field keeps its key when its label is reworded: answers already
    // given, and the repeat-visit rule, may refer to it.
    keyManual: true,
  }));
}

export function FormBuilder({ queueId }: { queueId: string }) {
  const { data, isLoading } = useFormFields(queueId);
  const replaceFormFields = useReplaceFormFields(queueId);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (data && !dirty) {
      setFields(toEditable(data.fields));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function updateField(localId: string, change: (field: EditableField) => EditableField) {
    setDirty(true);
    setFields((prev) => prev.map((f) => (f._localId === localId ? change(f) : f)));
  }

  function addField() {
    setDirty(true);
    setFields((prev) => [
      ...prev,
      {
        _localId: crypto.randomUUID(),
        key: '',
        label: '',
        type: 'text',
        required: false,
        options: [],
        keyManual: false,
      },
    ]);
  }

  function removeField(localId: string) {
    setDirty(true);
    setFields((prev) => prev.filter((f) => f._localId !== localId));
  }

  function moveField(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= fields.length) return;
    setDirty(true);
    setFields((prev) => {
      const next = [...prev];
      const temp = next[index]!;
      next[index] = next[targetIndex]!;
      next[targetIndex] = temp;
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    try {
      await replaceFormFields.mutateAsync(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        fields.map(({ _localId, keyManual, ...field }, index) => ({
          ...field,
          sortOrder: index,
          options: OPTION_TYPES.includes(field.type) ? field.options : [],
        })),
      );
      setDirty(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save form fields.');
    }
  }

  // ADR-056: labels and options are what customers read, so they follow the
  // same English/Latin rule the backend enforces on save.
  const hasTextErrors = fields.some((f) => latinTextError(f.label) || optionsError(f));
  // ADR-065: every row needs a label and a valid, unique key — a blank label
  // with a leftover key can never be saved.
  const duplicates = duplicateKeys(fields);
  const keyErrors = new Map(fields.map((f) => [f._localId, fieldKeyError(f, duplicates.has(f.key))]));
  const missingLabel = fields.some((f) => f.label.trim() === '');
  const hasKeyErrors = [...keyErrors.values()].some(Boolean);
  const blocked = hasTextErrors || missingLabel || hasKeyErrors;

  if (isLoading) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button variant="outline" onClick={() => setShowPreview(!showPreview)}>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-muted">
            <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
            <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
          </svg>
          {showPreview ? 'Hide Customer Preview' : 'Preview Customer Form'}
        </Button>
      </div>

      <ErrorBanner message={error} />

      {/* Customer Form Preview Box */}
      {showPreview && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/20 p-5 shadow-xs dark:border-brand-900 dark:bg-brand-950/20">
          <div className="mb-4 flex items-center justify-between border-b border-brand-200 dark:border-brand-900 pb-2">
            <span className="flex items-center gap-0.5 text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
              Customer Mobile Preview
              <InfoHelp label="the customer preview">What arriving customers see after scanning the QR code.</InfoHelp>
            </span>
          </div>

          {fields.length === 0 ? (
            <p className="text-xs text-muted italic">No custom fields defined yet. Add fields below to preview them.</p>
          ) : (
            <div className="space-y-3 max-w-md">
              {fields.map((f) => (
                <div key={f._localId} className="space-y-1">
                  <label className="block text-xs font-semibold text-fg">
                    {f.label || 'Untitled Question'}
                    {f.required && <span className="ml-1 text-rose-500">*</span>}
                  </label>
                  {f.type === 'dropdown' ? (
                    <select disabled className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg">
                      <option>Select an option…</option>
                      {(f.options ?? []).map((o, i) => (
                        <option key={i}>{o}</option>
                      ))}
                    </select>
                  ) : f.type === 'radio' ? (
                    <div className="space-y-1 pt-0.5">
                      {(f.options ?? ['Option 1', 'Option 2']).map((o, i) => (
                        <label key={i} className="flex items-center gap-2 text-xs text-fg-soft">
                          <input type="radio" disabled name={f._localId} />
                          <span>{o}</span>
                        </label>
                      ))}
                    </div>
                  ) : f.type === 'checkbox' ? (
                    <label className="flex items-center gap-2 text-xs text-fg-soft">
                      <input type="checkbox" disabled />
                      <span>{f.label || 'Confirm'}</span>
                    </label>
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : 'text'}
                      disabled
                      placeholder={f.placeholder || `Enter ${f.label || 'value'}…`}
                      className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg"
                    />
                  )}
                </div>
              ))}
              <div className="pt-2">
                <div className="w-full rounded-lg bg-brand-600 py-2 text-center text-xs font-bold text-white shadow-xs">
                  Join Queue & Get Token
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {fields.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          No custom fields yet. Click “Add Field” to require or request information from customers.
        </div>
      )}

      {/* Field List Editor */}
      <div className="space-y-3">
        {fields.map((field, idx) => (
          <div
            key={field._localId}
            className="rounded-xl border border-border bg-surface p-4 shadow-2xs transition-all hover:border-border-strong"
          >
            <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-subtle text-[11px] font-bold text-fg-soft">
                  {idx + 1}
                </span>
                <span className="text-xs font-semibold text-fg">
                  {field.label || 'New Field'}
                </span>
                <span className="rounded-md bg-subtle px-1.5 py-0.5 text-[10px] font-mono text-muted uppercase">
                  {field.type}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Move Up"
                  aria-label="Move Up"
                  disabled={idx === 0}
                  onClick={() => moveField(idx, 'up')}
                  className="rounded p-1 text-muted hover:bg-subtle disabled:opacity-30 transition-colors"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  type="button"
                  title="Move Down"
                  aria-label="Move Down"
                  disabled={idx === fields.length - 1}
                  onClick={() => moveField(idx, 'down')}
                  className="rounded p-1 text-muted hover:bg-subtle disabled:opacity-30 transition-colors"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-soft">Field Label</label>
                <input
                  value={field.label}
                  placeholder="e.g. Full Name, Student ID"
                  aria-label={`Field ${idx + 1} label`}
                  aria-invalid={latinTextError(field.label) ? true : undefined}
                  onChange={(e) => updateField(field._localId, (f) => withLabel(f, e.target.value))}
                  className={fieldInputClass}
                />
                <FieldError message={latinTextError(field.label)} />
              </div>

              <div>
                <div className="mb-1 flex items-center gap-0.5">
                  <label className="block text-xs font-medium text-fg-soft">Key</label>
                  <InfoHelp label="the field key">
                    A short identifier for this answer — letters, numbers and underscores. Filled in from the label until you type your own; clearing the label clears it too.
                  </InfoHelp>
                </div>
                <input
                  value={field.key}
                  placeholder="e.g. full_name"
                  aria-label={`Field ${idx + 1} key`}
                  aria-invalid={keyErrors.get(field._localId) ? true : undefined}
                  onChange={(e) => updateField(field._localId, (f) => withKey(f, e.target.value))}
                  className={`${fieldInputClass} font-mono`}
                />
                <FieldError message={keyErrors.get(field._localId) ?? null} />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-fg-soft">Type</label>
                <select
                  value={field.type}
                  aria-label={`Field ${idx + 1} type`}
                  onChange={(e) =>
                    updateField(field._localId, (f) => ({ ...f, type: e.target.value as FormFieldType }))
                  }
                  className={fieldInputClass}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end justify-between gap-3 pt-2 sm:justify-end sm:pt-5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-fg-soft cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(field._localId, (f) => ({ ...f, required: e.target.checked }))}
                    className="rounded border-border-strong text-brand-600 focus:ring-brand-500"
                  />
                  Required
                </label>
                <PermissionGate permission="manage_queues">
                  <Button variant="danger" size="md" onClick={() => removeField(field._localId)}>
                    Remove
                  </Button>
                </PermissionGate>
              </div>
            </div>

            {OPTION_TYPES.includes(field.type) && (
              <div className="mt-3 border-t border-border pt-3">
                <label className="mb-1 block text-xs font-medium text-fg-soft">Options (comma-separated)</label>
                <input
                  value={(field.options ?? []).join(', ')}
                  placeholder="Option 1, Option 2, Option 3"
                  aria-label={`Field ${idx + 1} options`}
                  aria-invalid={optionsError(field) ? true : undefined}
                  onChange={(e) =>
                    updateField(field._localId, (f) => ({
                      ...f,
                      options: e.target.value
                        .split(',')
                        .map((o) => o.trim())
                        .filter(Boolean),
                    }))
                  }
                  className={fieldInputClass}
                />
                <FieldError message={optionsError(field)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <PermissionGate permission="manage_queues">
        {/* One size for both (ADR-059): Save Form used to be lg beside an md Add Field. */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button variant="secondary" onClick={addField}>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            Add Field
          </Button>
          <Button
            disabled={!dirty || blocked}
            loading={replaceFormFields.isPending}
            onClick={() => void handleSave()}
          >
            {replaceFormFields.isPending ? 'Saving…' : 'Save Form'}
          </Button>
          {dirty && missingLabel && (
            <span className="text-xs text-muted">Give every field a label, or remove it, to save.</span>
          )}
        </div>
      </PermissionGate>
    </div>
  );
}

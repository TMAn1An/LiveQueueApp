import { useEffect, useState } from 'react';
import { useFormFields, useReplaceFormFields } from '../hooks/useFormFields';
import { Button } from './Button';
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

interface EditableField extends FormFieldInput {
  _localId: string;
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

  function updateField(localId: string, patch: Partial<EditableField>) {
    setDirty(true);
    setFields((prev) =>
      prev.map((f) => {
        if (f._localId !== localId) return f;
        const updated = { ...f, ...patch };
        // Suggest automatic key from label if key hasn't been manually typed yet
        if (patch.label && (!f.key || f.key === f.label.toLowerCase().replace(/[^a-z0-9_]/g, '_'))) {
          updated.key = patch.label.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
        }
        return updated;
      }),
    );
  }

  function addField() {
    setDirty(true);
    setFields((prev) => [
      ...prev,
      { _localId: crypto.randomUUID(), key: '', label: '', type: 'text', required: false, options: [] },
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
        fields.map(({ _localId, ...field }, index) => ({
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

  if (isLoading) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Define customer form questions. Responses appear on token rows for counter staff.
        </p>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-fg-soft hover:bg-subtle transition-colors"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-muted">
            <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
            <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
          </svg>
          {showPreview ? 'Hide Customer Preview' : 'Preview Customer Form'}
        </button>
      </div>

      <ErrorBanner message={error} />

      {/* Customer Form Preview Box */}
      {showPreview && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/20 p-5 shadow-xs dark:border-brand-900 dark:bg-brand-950/20">
          <div className="mb-4 flex items-center justify-between border-b border-brand-200 dark:border-brand-900 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
              Customer Mobile Preview
            </span>
            <span className="text-[11px] text-muted">What arriving customers see after scanning QR</span>
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
                  onChange={(e) => updateField(field._localId, { label: e.target.value })}
                  className="w-full rounded-md border border-border-strong px-2.5 py-1.5 text-sm bg-surface text-fg focus:border-brand-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-fg-soft">
                  Key <span className="text-[10px] text-muted font-normal">(identifier)</span>
                </label>
                <input
                  value={field.key}
                  placeholder="e.g. full_name"
                  onChange={(e) => updateField(field._localId, { key: e.target.value })}
                  className="w-full rounded-md border border-border-strong px-2.5 py-1.5 text-sm font-mono text-fg bg-surface focus:border-brand-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-fg-soft">Type</label>
                <select
                  value={field.type}
                  onChange={(e) => updateField(field._localId, { type: e.target.value as FormFieldType })}
                  className="w-full rounded-md border border-border-strong px-2.5 py-1.5 text-sm bg-surface text-fg focus:border-brand-500"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-6">
                <label className="flex items-center gap-1.5 text-xs font-medium text-fg-soft cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(field._localId, { required: e.target.checked })}
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
                  onChange={(e) =>
                    updateField(field._localId, {
                      options: e.target.value
                        .split(',')
                        .map((o) => o.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full rounded-md border border-border-strong px-2.5 py-1.5 text-sm bg-surface text-fg focus:border-brand-500"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <PermissionGate permission="manage_queues">
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button variant="secondary" onClick={addField}>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            Add Field
          </Button>
          <Button
            size="lg"
            disabled={!dirty || replaceFormFields.isPending}
            onClick={() => void handleSave()}
          >
            {replaceFormFields.isPending ? 'Saving…' : 'Save Form'}
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}

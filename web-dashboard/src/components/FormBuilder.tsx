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

/**
 * Spec section 7.6: dynamic form builder, atomic full-set replace (ADR-015
 * decision 2 — there is no per-field CRUD). Loads the queue's *current*
 * version via the Phase 6 GET addition (ADR-019) so staff edit real existing
 * fields rather than starting blank every time.
 */
export function FormBuilder({ queueId }: { queueId: string }) {
  const { data, isLoading } = useFormFields(queueId);
  const replaceFormFields = useReplaceFormFields(queueId);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) {
      setFields(toEditable(data.fields));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function updateField(localId: string, patch: Partial<EditableField>) {
    setDirty(true);
    setFields((prev) => prev.map((f) => (f._localId === localId ? { ...f, ...patch } : f)));
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

  async function handleSave() {
    setError(null);
    try {
      await replaceFormFields.mutateAsync(
        fields.map(({ _localId, ...field }) => ({
          ...field,
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
    <div>
      <ErrorBanner message={error} />
      {fields.length === 0 && <p className="mb-3 text-sm text-slate-500">No custom fields yet.</p>}
      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field._localId} className="rounded-md border border-slate-200 p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Key</label>
                <input
                  value={field.key}
                  onChange={(e) => updateField(field._localId, { key: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Label</label>
                <input
                  value={field.label}
                  onChange={(e) => updateField(field._localId, { label: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Type</label>
                <select
                  value={field.type}
                  onChange={(e) => updateField(field._localId, { type: e.target.value as FormFieldType })}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(field._localId, { required: e.target.checked })}
                  />
                  Required
                </label>
                <PermissionGate permission="manage_queues">
                  <Button variant="danger" onClick={() => removeField(field._localId)}>
                    Remove
                  </Button>
                </PermissionGate>
              </div>
            </div>
            {OPTION_TYPES.includes(field.type) && (
              <div className="mt-2">
                <label className="mb-1 block text-xs text-slate-500">Options (comma-separated)</label>
                <input
                  value={(field.options ?? []).join(', ')}
                  onChange={(e) =>
                    updateField(field._localId, {
                      options: e.target.value
                        .split(',')
                        .map((o) => o.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <PermissionGate permission="manage_queues">
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={addField}>
            Add Field
          </Button>
          <Button disabled={!dirty || replaceFormFields.isPending} onClick={() => void handleSave()}>
            {replaceFormFields.isPending ? 'Saving…' : 'Save Form'}
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}

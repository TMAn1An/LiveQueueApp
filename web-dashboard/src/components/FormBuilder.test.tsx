import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormBuilder } from './FormBuilder';
import { useFormFields, useReplaceFormFields } from '../hooks/useFormFields';
import { fieldKeyFromLabel, withKey, withLabel } from '../utils/formFieldKey';
import type { QueueFormField } from '../types/queue';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock('../hooks/useFormFields');

const mutateAsync = vi.fn();

function saved(overrides: Partial<QueueFormField> = {}): QueueFormField {
  return {
    id: 'f1',
    queueId: 'q1',
    key: 'student_id',
    label: 'Student ID',
    type: 'text',
    required: true,
    placeholder: null,
    options: [],
    sortOrder: 0,
    version: 1,
    ...overrides,
  };
}

function setup(fields: QueueFormField[] = []) {
  vi.mocked(useFormFields).mockReturnValue({
    data: { fields },
    isLoading: false,
  } as unknown as ReturnType<typeof useFormFields>);
  render(<FormBuilder queueId="q1" />);
}

const label = (n: number) => screen.getByLabelText(`Field ${n} label`);
const key = (n: number) => screen.getByLabelText(`Field ${n} key`) as HTMLInputElement;
const save = () => screen.getByRole('button', { name: 'Save Form' });

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({});
  vi.mocked(useReplaceFormFields).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useReplaceFormFields>);
});

describe('formFieldKey — one normalisation rule (ADR-065)', () => {
  it('keeps the builder’s existing rule', () => {
    expect(fieldKeyFromLabel('Full Name')).toBe('full_name');
    expect(fieldKeyFromLabel('Student ID')).toBe('student_id');
    expect(fieldKeyFromLabel('  Full Name  ')).toBe('full_name');
    expect(fieldKeyFromLabel('E-mail (work)')).toBe('e_mail__work_');
    expect(fieldKeyFromLabel('x'.repeat(40))).toHaveLength(32);
  });

  it('a typed key survives label edits; a blank label clears any key', () => {
    let field = withLabel({ label: '', key: '', keyManual: false }, 'Full Name');
    expect(field.key).toBe('full_name');
    field = withKey(field, 'name');
    field = withLabel(field, 'Full legal name');
    expect(field.key).toBe('name');
    field = withLabel(field, '   ');
    expect(field).toMatchObject({ key: '', keyManual: false });
  });
});

describe('FormBuilder — label and key stay in step (ADR-065)', () => {
  it('a label creates its key', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    await userEvent.type(label(1), 'Full Name');
    expect(key(1).value).toBe('full_name');
  });

  it('changing the label changes an auto-managed key', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    await userEvent.type(label(1), 'Full Name');
    await userEvent.clear(label(1));
    await userEvent.type(label(1), 'Student ID');
    expect(key(1).value).toBe('student_id');
  });

  it('a key typed by hand survives later label edits', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    await userEvent.type(label(1), 'Full Name');
    await userEvent.clear(key(1));
    await userEvent.type(key(1), 'name');
    await userEvent.type(label(1), ' (as on ID)');
    expect(key(1).value).toBe('name');
  });

  it('clearing the label clears the key — even one typed by hand', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    await userEvent.type(label(1), 'Full Name');
    await userEvent.clear(key(1));
    await userEvent.type(key(1), 'name');
    await userEvent.clear(label(1));
    expect(key(1).value).toBe('');
    // …and the label drives it again.
    await userEvent.type(label(1), 'Email');
    expect(key(1).value).toBe('email');
  });

  it('cannot save a blank label with a leftover key', async () => {
    setup([saved()]);
    await userEvent.clear(label(1));
    expect(key(1).value).toBe('');
    expect(save()).toBeDisabled();
    expect(screen.getByText(/Give every field a label/)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('cannot save an empty or duplicate key', async () => {
    setup([saved()]);
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    await userEvent.type(label(2), 'Student ID');
    expect(screen.getAllByText('Another field already uses this key.')).toHaveLength(2);
    expect(save()).toBeDisabled();
    await userEvent.clear(key(2));
    expect(screen.getByText('Enter a key for this field.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('removing a row removes everything that belonged to it', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    await userEvent.type(label(1), 'Colour');
    await userEvent.selectOptions(screen.getByLabelText('Field 1 type'), 'dropdown');
    await userEvent.type(screen.getByLabelText('Field 1 options'), 'Red, Blue');
    await userEvent.clear(key(1));
    await userEvent.type(key(1), 'custom');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText('Field 1 label')).not.toBeInTheDocument();

    // A new row starts clean: no old key, type, options or manual-key flag.
    await userEvent.click(screen.getByRole('button', { name: 'Add Field' }));
    expect(key(1).value).toBe('');
    expect((screen.getByLabelText('Field 1 type') as HTMLSelectElement).value).toBe('text');
    expect(screen.queryByLabelText('Field 1 options')).not.toBeInTheDocument();
    await userEvent.type(label(1), 'Phone');
    expect(key(1).value).toBe('phone');

    await userEvent.click(save());
    expect(mutateAsync).toHaveBeenCalledWith([
      { key: 'phone', label: 'Phone', type: 'text', required: false, options: [], sortOrder: 0 },
    ]);
  });

  it('editing a saved field keeps its key, and saves only the field data', async () => {
    setup([saved()]);
    expect(key(1).value).toBe('student_id');
    await userEvent.type(label(1), ' number');
    expect(key(1).value).toBe('student_id');

    await userEvent.click(save());
    expect(mutateAsync).toHaveBeenCalledWith([
      {
        key: 'student_id',
        label: 'Student ID number',
        type: 'text',
        required: true,
        placeholder: undefined,
        options: [],
        sortOrder: 0,
      },
    ]);
  });
});

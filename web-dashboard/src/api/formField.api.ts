import { apiFetch } from './client';
import type { QueueFormField, FormFieldType } from '../types/queue';

export interface FormFieldInput {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  sortOrder?: number;
}

interface FormFieldsResult {
  formVersion: number;
  fields: QueueFormField[];
}

export function getFormFields(queueId: string) {
  return apiFetch<FormFieldsResult>(`/api/queues/${queueId}/form-fields`);
}

/**
 * Atomic full-set replace (ADR-015 decision 2) — there is no per-field CRUD;
 * every call sends the complete field list for the queue's next form version.
 */
export function replaceFormFields(queueId: string, fields: FormFieldInput[]) {
  return apiFetch<FormFieldsResult>(`/api/queues/${queueId}/form-fields`, {
    method: 'PUT',
    body: { fields },
  });
}

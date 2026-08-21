import { z } from 'zod';
import { queueIdParams } from './queue.validators';

const formFieldType = z.enum([
  'text',
  'number',
  'email',
  'phone',
  'date',
  'dropdown',
  'radio',
  'checkbox',
]);

const formFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Field key is required.')
    .max(60)
    .regex(/^[a-zA-Z0-9_]+$/, 'Field key may only contain letters, numbers, and underscores.'),
  label: z.string().trim().min(1, 'Field label is required.').max(200),
  type: formFieldType,
  required: z.boolean().default(false),
  placeholder: z.string().trim().max(200).optional(),
  options: z.array(z.string().trim().min(1)).max(100).default([]),
  sortOrder: z.number().int().min(0).optional(),
});

export const replaceFormFieldsSchema = {
  params: queueIdParams,
  body: z.object({
    fields: z
      .array(formFieldSchema)
      .max(50, 'A queue may not define more than 50 form fields.')
      .default([])
      .refine(
        (fields) => new Set(fields.map((field) => field.key)).size === fields.length,
        'Field keys must be unique within the form.',
      ),
  }),
};

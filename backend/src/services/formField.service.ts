import type { z } from 'zod';
import { prisma } from '../config/prisma';
import { assertQueueMutable, requireOwnedQueue } from '../utils/tenantScope';
import type { replaceFormFieldsSchema } from '../validators/formField.validators';

type ReplaceFormFieldsInput = z.infer<typeof replaceFormFieldsSchema.body>;

/**
 * Atomic replace (ADR-009 / approved Phase 2 decision): never mutates or
 * deletes existing QueueFormField rows. Writes the new field set at
 * version = Queue.formVersion + 1 and bumps Queue.formVersion, both inside
 * one transaction, so historical versions stay exactly as they were.
 */
export async function replaceFormFields(
  organizationId: string,
  queueId: string,
  input: ReplaceFormFieldsInput,
) {
  const queue = await requireOwnedQueue(organizationId, queueId);
  assertQueueMutable(queue);
  const newVersion = queue.formVersion + 1;

  const fields = await prisma.$transaction(async (tx) => {
    if (input.fields.length > 0) {
      await tx.queueFormField.createMany({
        data: input.fields.map((field, index) => ({
          queueId,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          placeholder: field.placeholder,
          options: field.options,
          sortOrder: field.sortOrder ?? index,
          version: newVersion,
        })),
      });
    }

    await tx.queue.update({ where: { id: queueId }, data: { formVersion: newVersion } });

    return tx.queueFormField.findMany({
      where: { queueId, version: newVersion },
      orderBy: { sortOrder: 'asc' },
    });
  });

  return { formVersion: newVersion, fields };
}

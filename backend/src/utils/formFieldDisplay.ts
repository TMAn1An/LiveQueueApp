import { prisma } from '../config/prisma';

/**
 * A queue's form is fully dynamic (QueueFormField) — there is no reliable
 * universal "name"/"phone" key, so customer info is only ever presentable
 * as label/value pairs resolved from the queue's own field definitions
 * (Issue #4). Shared by dashboard.service.ts (Live Queue) and
 * device.service.ts (Blocked Devices customerContext) so the same
 * dynamic-label resolution logic isn't duplicated.
 */
export interface DisplayFormField {
  key: string;
  label: string;
  type: string;
  value: string;
}

interface FormFieldDef {
  key: string;
  label: string;
  type: string;
  sortOrder: number;
}

/**
 * A token's form data must be read back against the QueueFormField
 * definitions that were live at submission time — token.formVersion, not
 * the queue's current formVersion (ADR-009: old form versions stay
 * resolvable after the live form changes).
 */
export async function fetchFormFieldDefs(
  queueVersionPairs: { queueId: string; formVersion: number }[],
): Promise<Map<string, FormFieldDef[]>> {
  const uniquePairs = [...new Map(queueVersionPairs.map((p) => [`${p.queueId}:${p.formVersion}`, p])).values()];
  if (uniquePairs.length === 0) {
    return new Map();
  }

  const rows = await prisma.queueFormField.findMany({
    where: { OR: uniquePairs.map((p) => ({ queueId: p.queueId, version: p.formVersion })) },
    orderBy: { sortOrder: 'asc' },
    select: { queueId: true, version: true, key: true, label: true, type: true, sortOrder: true },
  });

  const byQueueVersion = new Map<string, FormFieldDef[]>();
  for (const row of rows) {
    const mapKey = `${row.queueId}:${row.version}`;
    const list = byQueueVersion.get(mapKey) ?? [];
    list.push({ key: row.key, label: row.label, type: row.type, sortOrder: row.sortOrder });
    byQueueVersion.set(mapKey, list);
  }
  return byQueueVersion;
}

/**
 * Renders a JSON form-data value as a display string, or null if there is
 * nothing meaningful to show. Defensive against every JSON shape the
 * dynamically-typed Token.formData column can legally hold — never throws.
 */
function stringifyFormValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  if (Array.isArray(raw)) {
    const items = raw
      .filter((v) => v !== null && v !== undefined && typeof v !== 'object')
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0);
    return items.length > 0 ? items.join(', ') : null;
  }
  // An unexpected nested object shape — skip rather than dump raw JSON into
  // a customer-facing display list.
  return null;
}

/**
 * Builds the display-ready {key, label, type, value} list for one token's
 * formData, using the field definitions for that token's exact
 * (queueId, formVersion) pair. Only fields with a meaningful value are
 * included — never invents a label, never guesses a "name" field.
 */
export function buildDisplayFormFields(
  queueId: string,
  formVersion: number,
  formData: unknown,
  defsByQueueVersion: Map<string, FormFieldDef[]>,
): DisplayFormField[] {
  if (formData === null || typeof formData !== 'object' || Array.isArray(formData)) {
    return [];
  }
  const data = formData as Record<string, unknown>;
  const defs = defsByQueueVersion.get(`${queueId}:${formVersion}`) ?? [];

  const result: DisplayFormField[] = [];
  for (const def of defs) {
    const value = stringifyFormValue(data[def.key]);
    if (value !== null) {
      result.push({ key: def.key, label: def.label, type: def.type, value });
    }
  }
  return result;
}

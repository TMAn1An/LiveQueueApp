import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createRestrictedStaff, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

describe('Dynamic form replace', () => {
  it('creates version 2 fields and bumps formVersion on the first replace', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken); // formVersion starts at 1, no fields yet

    const res = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        fields: [
          { key: 'full_name', label: 'Full Name', type: 'text', required: true },
          {
            key: 'phone',
            label: 'Phone Number',
            type: 'phone',
            required: true,
            placeholder: 'Enter phone number',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.formVersion).toBe(2);
    expect(res.body.data.fields).toHaveLength(2);
    const versions = (res.body.data.fields as Array<{ version: number }>).map((f) => f.version);
    expect(versions.every((v) => v === 2)).toBe(true);

    const queueRow = await prisma.queue.findUnique({ where: { id: queue.id } });
    expect(queueRow?.formVersion).toBe(2);
  });

  it('retains the previous version unchanged when replacing again', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const first = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'full_name', label: 'Full Name', type: 'text', required: true }] });
    const firstVersion = first.body.data.formVersion as number;

    const second = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'email', label: 'Email', type: 'email', required: false }] });
    const secondVersion = second.body.data.formVersion as number;

    expect(secondVersion).toBe(firstVersion + 1);

    const oldVersionRows = await prisma.queueFormField.findMany({
      where: { queueId: queue.id, version: firstVersion },
    });
    expect(oldVersionRows).toHaveLength(1);
    expect(oldVersionRows[0]?.key).toBe('full_name');

    const newVersionRows = await prisma.queueFormField.findMany({
      where: { queueId: queue.id, version: secondVersion },
    });
    expect(newVersionRows).toHaveLength(1);
    expect(newVersionRows[0]?.key).toBe('email');
  });

  it('keeps Queue.formVersion and the persisted field rows in agreement (atomic outcome)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'a', label: 'A', type: 'text' }] });

    const queueRow = await prisma.queue.findUnique({ where: { id: queue.id } });
    const fieldRows = await prisma.queueFormField.findMany({
      where: { queueId: queue.id, version: res.body.data.formVersion },
    });
    expect(queueRow?.formVersion).toBe(res.body.data.formVersion);
    expect(fieldRows).toHaveLength(1);
  });

  it('rolls back the entire transaction when the field write fails partway through', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    // Establish a known-good baseline version.
    const baseline = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'full_name', label: 'Full Name', type: 'text', required: true }] });
    expect(baseline.status).toBe(200);
    const baselineVersion = baseline.body.data.formVersion as number;

    // Poison the version the *next* replace call will target: pre-seed a row
    // directly (test-only failure mechanism, no production code touched) so
    // that the real createMany batch insert inside replaceFormFields hits a
    // genuine unique-constraint violation on (queueId, version, key) and the
    // whole statement — and therefore the whole transaction — is rejected by
    // Postgres itself, not simulated.
    const targetVersion = baselineVersion + 1;
    await prisma.queueFormField.create({
      data: {
        queueId: queue.id,
        key: 'phone',
        label: 'Pre-existing (poison row)',
        type: 'phone',
        version: targetVersion,
      },
    });

    const attempt = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        fields: [
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'phone', label: 'Phone', type: 'phone' }, // collides with the poison row
        ],
      });

    expect(attempt.status).toBe(409);
    expect(attempt.body.error.code).toBe('CONFLICT');

    // 1. Queue.formVersion is unchanged.
    const queueRow = await prisma.queue.findUnique({ where: { id: queue.id } });
    expect(queueRow?.formVersion).toBe(baselineVersion);

    // 2. The previous version's rows are unchanged.
    const previousVersionRows = await prisma.queueFormField.findMany({
      where: { queueId: queue.id, version: baselineVersion },
    });
    expect(previousVersionRows).toHaveLength(1);
    expect(previousVersionRows[0]?.key).toBe('full_name');

    // 3 & 4. No partial new rows for the attempted version, and no partial
    // form version: the only row at targetVersion is the pre-existing poison
    // row — neither 'email' (which didn't itself collide) nor a second
    // 'phone' row was inserted, proving the batch insert was all-or-nothing.
    const targetVersionRows = await prisma.queueFormField.findMany({
      where: { queueId: queue.id, version: targetVersion },
    });
    expect(targetVersionRows).toHaveLength(1);
    expect(targetVersionRows[0]?.label).toBe('Pre-existing (poison row)');
  });

  it('rejects duplicate keys within the same submission', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        fields: [
          { key: 'phone', label: 'Phone', type: 'phone' },
          { key: 'phone', label: 'Phone Again', type: 'phone' },
        ],
      });

    expect(res.status).toBe(422);
  });

  it('enforces key uniqueness within a queue/version at the database level too', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    await expect(
      prisma.queueFormField.createMany({
        data: [
          { queueId: queue.id, key: 'dup', label: 'Dup 1', type: 'text', version: 1 },
          { queueId: queue.id, key: 'dup', label: 'Dup 2', type: 'text', version: 1 },
        ],
      }),
    ).rejects.toThrow();
  });

  it('allows the same key to reappear across different versions', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'phone', label: 'Phone', type: 'phone' }] });

    const res = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'phone', label: 'Phone Number', type: 'phone' }] });

    expect(res.status).toBe(200);
  });

  it('rejects an invalid field type', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'x', label: 'X', type: 'not-a-real-type' }] });

    expect(res.status).toBe(422);
  });

  it('allows clearing the form with an empty fields array', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [{ key: 'a', label: 'A', type: 'text' }] });

    const res = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ fields: [] });

    expect(res.status).toBe(200);
    expect(res.body.data.fields).toHaveLength(0);
  });
});

describe('Dynamic form permissions', () => {
  it('blocks form replacement without manage_queues', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const restricted = await createRestrictedStaff(ctx.organizationId, ['manage_services']);

    const res = await api()
      .put(`/api/queues/${queue.id}/form-fields`)
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({ fields: [] });

    expect(res.status).toBe(403);
  });
});

describe('Dynamic form tenant isolation', () => {
  it("rejects replacing the form for another organization's queue", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueA = await createQueue(orgA.accessToken);

    const res = await api()
      .put(`/api/queues/${queueA.id}/form-fields`)
      .set('Authorization', `Bearer ${orgB.accessToken}`)
      .send({ fields: [] });

    expect(res.status).toBe(404);
  });
});

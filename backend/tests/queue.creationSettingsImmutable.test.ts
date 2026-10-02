import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createStaffWithRole, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

/**
 * ADR-055: multiple-service support and the service-start verification code
 * are chosen when a queue is created and are fixed for its lifetime. The
 * backend enforces it — the dashboard rendering them read-only is not what
 * stops a change.
 */

beforeEach(async () => {
  await resetDb();
});

function createRaw(accessToken: string, body: Record<string, unknown>) {
  return api()
    .post('/api/queues')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Main Hall', tokenPrefix: 'M', ...body });
}

function updateQueue(accessToken: string, queueId: string, body: Record<string, unknown>) {
  return api()
    .put(`/api/queues/${queueId}`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);
}

async function stored(queueId: string) {
  return prisma.queue.findUniqueOrThrow({
    where: { id: queueId },
    select: { allowMultipleServices: true, requireServiceStartOtp: true, name: true },
  });
}

describe('ADR-055 — creation', () => {
  it('a new queue does not require the service-start code unless the creator turns it on', async () => {
    const ctx = await registerOwner();
    const res = await createRaw(ctx.accessToken, {});
    expect(res.status).toBe(201);
    expect(res.body.data.requireServiceStartOtp).toBe(false);
    // Multiple services keep their existing default.
    expect(res.body.data.allowMultipleServices).toBe(true);
  });

  it('the column default is now false, so a row written without the field is off too', async () => {
    const rows = await prisma.$queryRaw<{ column_default: string; is_nullable: string }[]>`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'queues' AND column_name = 'require_service_start_otp'
    `;
    expect(rows).toEqual([{ column_default: 'false', is_nullable: 'NO' }]);
  });

  it('persists every combination chosen at creation', async () => {
    const ctx = await registerOwner();
    for (const allowMultipleServices of [true, false]) {
      for (const requireServiceStartOtp of [true, false]) {
        const res = await createRaw(ctx.accessToken, {
          name: `Q ${String(allowMultipleServices)} ${String(requireServiceStartOtp)}`,
          allowMultipleServices,
          requireServiceStartOtp,
        });
        expect(res.status).toBe(201);
        expect(await stored(res.body.data.id)).toMatchObject({
          allowMultipleServices,
          requireServiceStartOtp,
        });
      }
    }
  });
});

describe('ADR-055 — no change after creation, in either direction', () => {
  const cases = [
    { field: 'requireServiceStartOtp', from: false, to: true },
    { field: 'requireServiceStartOtp', from: true, to: false },
    { field: 'allowMultipleServices', from: false, to: true },
    { field: 'allowMultipleServices', from: true, to: false },
  ] as const;

  for (const { field, from, to } of cases) {
    it(`${field}: ${String(from)} -> ${String(to)} is refused with QUEUE_SETTING_IMMUTABLE`, async () => {
      const ctx = await registerOwner();
      const queue = await createQueue(ctx.accessToken, { [field]: from });

      const res = await updateQueue(ctx.accessToken, queue.id, { [field]: to });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('QUEUE_SETTING_IMMUTABLE');
      expect(res.body.error.details).toEqual({ field });
      expect((await stored(queue.id))[field]).toBe(from);
    });
  }

  it('a change smuggled alongside a legitimate edit refuses the whole request', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken, { requireServiceStartOtp: false });

    const res = await updateQueue(ctx.accessToken, queue.id, {
      name: 'Renamed',
      requireServiceStartOtp: true,
    });
    expect(res.status).toBe(409);
    expect(await stored(queue.id)).toMatchObject({
      name: queue.name,
      requireServiceStartOtp: false,
    });
  });

  it('repeating the stored value is a harmless no-op, and unrelated edits leave both alone', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken, {
      allowMultipleServices: false,
      requireServiceStartOtp: true,
    });

    const same = await updateQueue(ctx.accessToken, queue.id, {
      allowMultipleServices: false,
      requireServiceStartOtp: true,
      name: 'Renamed',
    });
    expect(same.status).toBe(200);

    const rename = await updateQueue(ctx.accessToken, queue.id, { name: 'Renamed again' });
    expect(rename.status).toBe(200);
    expect(await stored(queue.id)).toEqual({
      name: 'Renamed again',
      allowMultipleServices: false,
      requireServiceStartOtp: true,
    });
  });

  it('applies to ADMIN exactly as to OWNER — no role may change them', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken, { requireServiceStartOtp: true });
    const admin = await createStaffWithRole(ctx.organizationId, 'ADMIN');

    const res = await updateQueue(admin.accessToken, queue.id, { requireServiceStartOtp: false });
    expect(res.status).toBe(409);
    expect((await stored(queue.id)).requireServiceStartOtp).toBe(true);
  });

  it('a queue that existed before this rule keeps — and is frozen at — the value it had', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    // Stand-in for a production queue created under ADR-041's on-by-default:
    // its stored value is simply whatever it was, and nothing migrates it.
    await prisma.queue.update({
      where: { id: queue.id },
      data: { requireServiceStartOtp: true, allowMultipleServices: false },
    });

    const off = await updateQueue(ctx.accessToken, queue.id, { requireServiceStartOtp: false });
    expect(off.status).toBe(409);
    const multi = await updateQueue(ctx.accessToken, queue.id, { allowMultipleServices: true });
    expect(multi.status).toBe(409);
    expect(await stored(queue.id)).toMatchObject({
      requireServiceStartOtp: true,
      allowMultipleServices: false,
    });
  });
});

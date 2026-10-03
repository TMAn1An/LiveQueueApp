import { beforeEach, describe, expect, it } from 'vitest';
import { api, createCounter, createQueue, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
});

async function setupOrg() {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken);
  const first = await createCounter(ctx.accessToken, queue.id, { name: 'Counter 1' });
  const second = await createCounter(ctx.accessToken, queue.id, { name: 'Counter 2' });
  return { ...ctx, queue, first, second };
}

function assign(accessToken: string, counterId: string, staffId: string | null) {
  return api()
    .patch(`/api/counters/${counterId}/assign`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ staffId });
}

function availableStaff(accessToken: string, counterId: string) {
  return api()
    .get(`/api/counters/${counterId}/available-staff`)
    .set('Authorization', `Bearer ${accessToken}`);
}

/** Staff are created directly so their name/status can be pinned. */
/** ADR-069: added as Executives of the queue's Admin, the only people who
 * may operate its counters. */
async function addStaff(
  org: { organizationId: string; queue: { id: string } },
  name: string,
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
) {
  const { adminId } = await prisma.queue.findUniqueOrThrow({ where: { id: org.queue.id }, select: { adminId: true } });
  return prisma.staff.create({
    data: {
      organizationId: org.organizationId,
      workspaceAdminId: adminId,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: 'STAFF',
      permissions: [],
      status,
    },
  });
}

describe('counter staff assignment', () => {
  it('assigns a free staff member', async () => {
    const org = await setupOrg();
    const staff = await addStaff(org, 'Kara');

    const res = await assign(org.accessToken, org.first.id, staff.id);

    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(staff.id);
  });

  it('refuses to move a staff member who already holds another counter', async () => {
    const org = await setupOrg();
    const staff = await addStaff(org, 'Kara');
    await assign(org.accessToken, org.first.id, staff.id);

    const res = await assign(org.accessToken, org.second.id, staff.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OPERATOR_ALREADY_ASSIGNED');
    // The original assignment is untouched — never silently moved.
    const first = await prisma.counter.findUniqueOrThrow({ where: { id: org.first.id } });
    expect(first.staffId).toBe(staff.id);
  });

  it('lets a counter keep the person it already has', async () => {
    const org = await setupOrg();
    const staff = await addStaff(org, 'Kara');
    await assign(org.accessToken, org.first.id, staff.id);

    const res = await assign(org.accessToken, org.first.id, staff.id);

    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(staff.id);
  });

  it('frees the staff member again when the assignment is cleared', async () => {
    const org = await setupOrg();
    const staff = await addStaff(org, 'Kara');
    await assign(org.accessToken, org.first.id, staff.id);

    // ADR-069 (D5): an open or paused counter is never simply emptied —
    // turning it off is what releases its operator.
    const refused = await assign(org.accessToken, org.first.id, null);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('COUNTER_MUST_BE_OFF');
    await api()
      .patch(`/api/counters/${org.first.id}/status`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ status: 'OFFLINE' })
      .expect(200);
    const unassign = await assign(org.accessToken, org.first.id, null);
    expect(unassign.status).toBe(200);
    expect(unassign.body.data.staffId).toBeNull();

    const reassign = await assign(org.accessToken, org.second.id, staff.id);
    expect(reassign.status).toBe(200);
  });

  it("refuses a staff member from another organization", async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    const outsider = await addStaff(orgB, 'Outsider');

    const res = await assign(orgA.accessToken, orgA.first.id, outsider.id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAFF_ORGANIZATION_MISMATCH');
  });

  it('refuses a suspended staff member', async () => {
    const org = await setupOrg();
    const suspended = await addStaff(org, 'Suspended Sam', 'SUSPENDED');

    const res = await assign(org.accessToken, org.first.id, suspended.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OPERATOR_NOT_ASSIGNABLE');
  });

  /**
   * The service's read-then-write check cannot see a concurrent writer, so
   * the unique index on Counter.staffId is what actually holds the rule.
   */
  it('cannot assign the same person to two counters concurrently', async () => {
    const org = await setupOrg();
    const staff = await addStaff(org, 'Kara');

    const results = await Promise.all([
      assign(org.accessToken, org.first.id, staff.id),
      assign(org.accessToken, org.second.id, staff.id),
    ]);

    const succeeded = results.filter((res) => res.status === 200);
    expect(succeeded).toHaveLength(1);
    expect(results.filter((res) => res.status === 409)).toHaveLength(1);

    const holders = await prisma.counter.count({ where: { staffId: staff.id } });
    expect(holders).toBe(1);
  });
});

describe('GET /api/counters/:counterId/available-staff', () => {
  // ADR-064: someone on another counter is listed with that counter, so the
  // dashboard can offer an explicit move — never as freely assignable.
  it('offers free active people, and marks anyone holding another counter', async () => {
    const org = await setupOrg();
    const free = await addStaff(org, 'Free Fiona');
    const busy = await addStaff(org, 'Busy Bilal');
    await assign(org.accessToken, org.second.id, busy.id);

    const res = await availableStaff(org.accessToken, org.first.id);

    expect(res.status).toBe(200);
    const byId = new Map(
      res.body.data.map((s: { id: string; currentCounter: unknown }) => [s.id, s.currentCounter]),
    );
    expect(byId.get(free.id)).toBeNull();
    expect(byId.get(busy.id)).toMatchObject({ id: org.second.id });
  });

  it("still offers the counter's own current holder", async () => {
    const org = await setupOrg();
    const staff = await addStaff(org, 'Kara');
    await assign(org.accessToken, org.first.id, staff.id);

    const res = await availableStaff(org.accessToken, org.first.id);

    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(staff.id);
  });

  it('keeps a holder listed while their counter is on break', async () => {
    const org = await setupOrg();
    const busy = await addStaff(org, 'Busy Bilal');
    await assign(org.accessToken, org.second.id, busy.id);
    await api()
      .patch(`/api/counters/${org.second.id}/status`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ status: 'ON_BREAK' });

    // Counter status is not a presence system: a paused counter keeps its
    // person (ADR-069).
    const res = await availableStaff(org.accessToken, org.first.id);

    const entry = res.body.data.find((s: { id: string }) => s.id === busy.id);
    expect(entry.currentCounter).toMatchObject({ id: org.second.id });
  });

  it('lists a holder as free once their counter is turned off (ADR-069, D5)', async () => {
    const org = await setupOrg();
    const busy = await addStaff(org, 'Busy Bilal');
    await assign(org.accessToken, org.second.id, busy.id);
    await api()
      .patch(`/api/counters/${org.second.id}/status`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ status: 'OFFLINE' })
      .expect(200);

    const res = await availableStaff(org.accessToken, org.first.id);

    const entry = res.body.data.find((s: { id: string }) => s.id === busy.id);
    expect(entry.currentCounter).toBeNull();
  });

  it('excludes suspended staff', async () => {
    const org = await setupOrg();
    const suspended = await addStaff(org, 'Suspended Sam', 'SUSPENDED');

    const res = await availableStaff(org.accessToken, org.first.id);

    expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(suspended.id);
  });

  it("never lists another organization's staff", async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    const outsider = await addStaff(orgB, 'Outsider');

    const res = await availableStaff(orgA.accessToken, orgA.first.id);

    expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(outsider.id);
  });

  it('is not reachable for a counter belonging to another organization', async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();

    const res = await availableStaff(orgA.accessToken, orgB.first.id);

    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const org = await setupOrg();

    const res = await api().get(`/api/counters/${org.first.id}/available-staff`);

    expect(res.status).toBe(401);
  });
});

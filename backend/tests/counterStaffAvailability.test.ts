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
async function addStaff(
  organizationId: string,
  name: string,
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
) {
  return prisma.staff.create({
    data: {
      organizationId,
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
    const staff = await addStaff(org.organizationId, 'Kara');

    const res = await assign(org.accessToken, org.first.id, staff.id);

    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(staff.id);
  });

  it('refuses to move a staff member who already holds another counter', async () => {
    const org = await setupOrg();
    const staff = await addStaff(org.organizationId, 'Kara');
    await assign(org.accessToken, org.first.id, staff.id);

    const res = await assign(org.accessToken, org.second.id, staff.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAFF_ALREADY_ASSIGNED');
    // The original assignment is untouched — never silently moved.
    const first = await prisma.counter.findUniqueOrThrow({ where: { id: org.first.id } });
    expect(first.staffId).toBe(staff.id);
  });

  it('lets a counter keep the person it already has', async () => {
    const org = await setupOrg();
    const staff = await addStaff(org.organizationId, 'Kara');
    await assign(org.accessToken, org.first.id, staff.id);

    const res = await assign(org.accessToken, org.first.id, staff.id);

    expect(res.status).toBe(200);
    expect(res.body.data.staffId).toBe(staff.id);
  });

  it('frees the staff member again when the assignment is cleared', async () => {
    const org = await setupOrg();
    const staff = await addStaff(org.organizationId, 'Kara');
    await assign(org.accessToken, org.first.id, staff.id);

    const unassign = await assign(org.accessToken, org.first.id, null);
    expect(unassign.status).toBe(200);
    expect(unassign.body.data.staffId).toBeNull();

    const reassign = await assign(org.accessToken, org.second.id, staff.id);
    expect(reassign.status).toBe(200);
  });

  it("refuses a staff member from another organization", async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    const outsider = await addStaff(orgB.organizationId, 'Outsider');

    const res = await assign(orgA.accessToken, orgA.first.id, outsider.id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAFF_ORGANIZATION_MISMATCH');
  });

  it('refuses a suspended staff member', async () => {
    const org = await setupOrg();
    const suspended = await addStaff(org.organizationId, 'Suspended Sam', 'SUSPENDED');

    const res = await assign(org.accessToken, org.first.id, suspended.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAFF_NOT_ASSIGNABLE');
  });

  /**
   * The service's read-then-write check cannot see a concurrent writer, so
   * the unique index on Counter.staffId is what actually holds the rule.
   */
  it('cannot assign the same person to two counters concurrently', async () => {
    const org = await setupOrg();
    const staff = await addStaff(org.organizationId, 'Kara');

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
  it('offers free active staff and hides anyone holding another counter', async () => {
    const org = await setupOrg();
    const free = await addStaff(org.organizationId, 'Free Fiona');
    const busy = await addStaff(org.organizationId, 'Busy Bilal');
    await assign(org.accessToken, org.second.id, busy.id);

    const res = await availableStaff(org.accessToken, org.first.id);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(busy.id);
  });

  it("still offers the counter's own current holder", async () => {
    const org = await setupOrg();
    const staff = await addStaff(org.organizationId, 'Kara');
    await assign(org.accessToken, org.first.id, staff.id);

    const res = await availableStaff(org.accessToken, org.first.id);

    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(staff.id);
  });

  it('keeps a holder listed even while their counter is on break or offline', async () => {
    const org = await setupOrg();
    const busy = await addStaff(org.organizationId, 'Busy Bilal');
    await assign(org.accessToken, org.second.id, busy.id);
    await api()
      .patch(`/api/counters/${org.second.id}/status`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ status: 'OFFLINE' });

    // Counter status is not a presence system: they hold the counter until
    // explicitly unassigned.
    const res = await availableStaff(org.accessToken, org.first.id);

    expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(busy.id);
  });

  it('excludes suspended staff', async () => {
    const org = await setupOrg();
    const suspended = await addStaff(org.organizationId, 'Suspended Sam', 'SUSPENDED');

    const res = await availableStaff(org.accessToken, org.first.id);

    expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(suspended.id);
  });

  it("never lists another organization's staff", async () => {
    const orgA = await setupOrg();
    const orgB = await setupOrg();
    const outsider = await addStaff(orgB.organizationId, 'Outsider');

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

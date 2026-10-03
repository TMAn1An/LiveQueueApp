import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createToken,
  createTokenRequest,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

/**
 * ADR-068: one public QR per organization (`/visit/{publicCode}`), resolved
 * by GET /api/public/organizations/:publicCode to the organization's listed
 * queues and their state — for the Safari portal and the Android app alike.
 */

beforeEach(async () => {
  await resetDb();
});

async function publicCodeOf(organizationId: string) {
  return (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).publicCode;
}

function visit(code: string) {
  return api().get(`/api/public/organizations/${code}`);
}

function updateQueue(token: string, queueId: string, body: Record<string, unknown>) {
  return api().put(`/api/queues/${queueId}`).set('Authorization', `Bearer ${token}`).send(body);
}

async function org() {
  const owner = await registerOwner({ organizationName: `Abc Hospital ${Math.random().toString(36).slice(2, 6)}` });
  const code = await publicCodeOf(owner.organizationId);
  return { owner, code };
}

describe('organization public code', () => {
  it('every organization gets its own random, URL-safe code — not its id or name', async () => {
    const a = await org();
    const b = await org();
    expect(a.code).toMatch(/^[a-z0-9]{12}$/);
    expect(a.code).not.toBe(b.code);
    expect(a.code).not.toContain(a.owner.organizationId.slice(0, 8));
  });

  it('is exposed to the organization’s own staff for printing the QR', async () => {
    const { owner, code } = await org();
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(me.body.data.organization.publicCode).toBe(code);
  });

  it('stays the same when queues are renamed, added and removed', async () => {
    const { owner, code } = await org();
    const q = await createQueue(owner.accessToken, { name: 'Emergency' });
    await updateQueue(owner.accessToken, q.id, { name: 'Emergency Care' });
    const q2 = await createQueue(owner.accessToken, { name: 'Pharmacy', tokenPrefix: 'P' });
    await api().delete(`/api/queues/${q2.id}`).set('Authorization', `Bearer ${owner.accessToken}`).send({ reason: 'No longer needed' });
    expect(await publicCodeOf(owner.organizationId)).toBe(code);
    const res = await visit(code);
    expect(res.body.data.queues.map((x: { name: string }) => x.name)).toEqual(['Emergency Care']);
  });
});

describe('GET /api/public/organizations/:publicCode', () => {
  it('resolves the code (any case) to the organization and its listed queues, sorted', async () => {
    const { owner, code } = await org();
    const pharmacy = await createQueue(owner.accessToken, { name: 'Pharmacy', tokenPrefix: 'P' });
    const emergency = await createQueue(owner.accessToken, { name: 'Emergency', tokenPrefix: 'E' });
    await createService(owner.accessToken, pharmacy.id);
    await createService(owner.accessToken, emergency.id);

    const res = await visit(code.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.body.data.organization).toEqual({ name: expect.stringContaining('Abc Hospital'), publicCode: code });
    expect(res.body.data.queues.map((q: { name: string }) => q.name)).toEqual(['Emergency', 'Pharmacy']);
    expect(res.body.data.queues[0]).toMatchObject({ availability: 'JOINABLE', closedReason: null, waitingCount: 0 });
  });

  it('answers 404 for unknown, malformed, or suspended organizations — the same way', async () => {
    const { owner, code } = await org();
    for (const bad of ['zzzzzzzzzzzz', 'not a code!', 'ab']) {
      const res = await visit(encodeURIComponent(bad));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
    }
    await prisma.organization.update({ where: { id: owner.organizationId }, data: { status: 'SUSPENDED' } });
    const suspended = await visit(code);
    expect(suspended.status).toBe(404);
    expect(suspended.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('never lists a hidden or archived queue', async () => {
    const { owner, code } = await org();
    const shown = await createQueue(owner.accessToken, { name: 'Billing', tokenPrefix: 'B' });
    const hidden = await createQueue(owner.accessToken, { name: 'Staff only', tokenPrefix: 'S' });
    const archived = await createQueue(owner.accessToken, { name: 'Old', tokenPrefix: 'O' });
    await createService(owner.accessToken, shown.id);
    expect((await updateQueue(owner.accessToken, hidden.id, { listedOnOrganizationPage: false })).status).toBe(200);
    await api().delete(`/api/queues/${archived.id}`).set('Authorization', `Bearer ${owner.accessToken}`).send({ reason: 'No longer needed' });

    const names = (await visit(code)).body.data.queues.map((q: { name: string }) => q.name);
    expect(names).toEqual(['Billing']);
  });

  it('shows paused, inactive, unconfigured and closed-by-schedule queues as visible but closed', async () => {
    const { owner, code } = await org();
    const paused = await createQueue(owner.accessToken, { name: 'A Paused', tokenPrefix: 'A' });
    const inactive = await createQueue(owner.accessToken, { name: 'B Inactive', tokenPrefix: 'B' });
    await createQueue(owner.accessToken, { name: 'C No services', tokenPrefix: 'C' });
    const scheduled = await createQueue(owner.accessToken, { name: 'D Scheduled', tokenPrefix: 'D' });
    for (const q of [paused, inactive, scheduled]) await createService(owner.accessToken, q.id);
    const setStatus = (id: string, status: string) =>
      api().patch(`/api/queues/${id}/status`).set('Authorization', `Bearer ${owner.accessToken}`).send({ status });
    expect((await setStatus(paused.id, 'PAUSED')).status).toBe(200);
    expect((await setStatus(inactive.id, 'INACTIVE')).status).toBe(200);
    // Scheduling on, with no session at all: closed every day.
    expect((await updateQueue(owner.accessToken, scheduled.id, { timezone: 'UTC', scheduleEnabled: true })).status).toBe(200);

    const queues = (await visit(code)).body.data.queues as {
      name: string;
      availability: string;
      closedReason: string;
      message: string | null;
    }[];
    const byName = Object.fromEntries(queues.map((q) => [q.name, q]));
    expect(byName['A Paused']).toMatchObject({ availability: 'CLOSED', closedReason: 'PAUSED' });
    expect(byName['B Inactive']).toMatchObject({ availability: 'CLOSED', closedReason: 'INACTIVE' });
    expect(byName['C No services']).toMatchObject({ availability: 'CLOSED', closedReason: 'NOT_READY' });
    expect(byName['D Scheduled']).toMatchObject({ availability: 'CLOSED', closedReason: 'SCHEDULE' });
    expect(byName['D Scheduled']!.message).toEqual(expect.any(String));
  });

  it('reports how many people are waiting and an estimate for a new arrival', async () => {
    const { owner, code } = await org();
    const q = await createQueue(owner.accessToken, { name: 'Emergency', tokenPrefix: 'E' });
    const service = await createService(owner.accessToken, q.id, { durationMinutes: 10 });
    const counter = await createCounter(owner.accessToken, q.id);
    await setCounterStatus(owner.accessToken, counter.id, 'ACTIVE');
    await createToken({ queueId: q.id, serviceId: service.id, formData: {} });
    await createToken({ queueId: q.id, serviceId: service.id, formData: {} });

    const [listed] = (await visit(code)).body.data.queues;
    expect(listed.waitingCount).toBe(2);
    // One open counter, two people of 10 minutes ahead: a new arrival is
    // called in about 20 — what their own token would then show.
    expect(listed.estimatedWaitMinutes).toBe(20);
  });

  it('gives no wait estimate while no counter is open', async () => {
    const { owner, code } = await org();
    const q = await createQueue(owner.accessToken, { name: 'Emergency', tokenPrefix: 'E' });
    const service = await createService(owner.accessToken, q.id, { durationMinutes: 10 });
    await createToken({ queueId: q.id, serviceId: service.id, formData: {} });

    const [listed] = (await visit(code)).body.data.queues;
    expect(listed.waitingCount).toBe(1);
    expect(listed.estimatedWaitMinutes).toBeNull();
  });

  it('exposes nothing private: no staff, counters, devices, form answers or internal ids', async () => {
    const { owner, code } = await org();
    const q = await createQueue(owner.accessToken, { name: 'Emergency', tokenPrefix: 'E' });
    const service = await createService(owner.accessToken, q.id);
    await createCounter(owner.accessToken, q.id, { name: 'Secret Desk' });
    const deviceIdentifier = randomUUID();
    await createToken({ queueId: q.id, serviceId: service.id, deviceIdentifier });

    const body = JSON.stringify((await visit(code)).body);
    expect(body).not.toContain(owner.email);
    expect(body).not.toContain(owner.organizationId);
    expect(body).not.toContain('Secret Desk');
    expect(body).not.toContain(deviceIdentifier);
    expect(body).not.toContain('staff');
  });
});

describe('joining from the organization page (browser installation identity)', () => {
  it('uses the same join rules: one active visit per installation per queue, others still allowed', async () => {
    const { owner, code } = await org();
    const a = await createQueue(owner.accessToken, { name: 'A', tokenPrefix: 'A' });
    const b = await createQueue(owner.accessToken, { name: 'B', tokenPrefix: 'B' });
    const sa = await createService(owner.accessToken, a.id);
    const sb = await createService(owner.accessToken, b.id);
    const listed = (await visit(code)).body.data.queues as { id: string }[];
    expect(listed.map((q) => q.id).sort()).toEqual([a.id, b.id].sort());

    const browserInstallationId = randomUUID();
    const first = await createTokenRequest({ queueId: a.id, serviceId: sa.id, deviceIdentifier: browserInstallationId });
    expect(first.status).toBe(201);
    const again = await createTokenRequest({ queueId: a.id, serviceId: sa.id, deviceIdentifier: browserInstallationId });
    expect(again.status).toBe(409);
    const other = await createTokenRequest({ queueId: b.id, serviceId: sb.id, deviceIdentifier: browserInstallationId });
    expect(other.status).toBe(201);
  });

  it('the listing never overrides the join: a hidden queue is still joined by its own id only as before', async () => {
    const { owner } = await org();
    const q = await createQueue(owner.accessToken, { name: 'Hidden', tokenPrefix: 'H' });
    const s = await createService(owner.accessToken, q.id);
    await updateQueue(owner.accessToken, q.id, { listedOnOrganizationPage: false });
    // Legacy per-queue QR links keep working (ADR-068 migration).
    const res = await createTokenRequest({ queueId: q.id, serviceId: s.id, deviceIdentifier: randomUUID() });
    expect(res.status).toBe(201);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createStaffWithRole,
  createToken,
  registerOwner,
  setCounterStatus,
  setFormFields,
  startToken,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

beforeEach(async () => {
  await resetDb();
  await prisma.device.deleteMany({});
});

/** An organization with one queue, service and active counter — the minimum
 * needed to take a token all the way through to COMPLETED. */
async function setupOrg(queueName = 'Front Desk') {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken, { name: queueName });
  const service = await createService(ctx.accessToken, queue.id, { serviceName: 'Passport Renewal' });
  const counter = await createCounter(ctx.accessToken, queue.id, { name: 'Counter 1' });
  await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
  return { ...ctx, queue, service, counter };
}

/** Drives one token from creation through to COMPLETED. */
async function completeOneToken(
  org: Awaited<ReturnType<typeof setupOrg>>,
  overrides: { deviceIdentifier?: string; formData?: Record<string, unknown> } = {},
) {
  const token = await createToken({
    queueId: org.queue.id,
    serviceId: org.service.id,
    deviceIdentifier: overrides.deviceIdentifier,
    formData: overrides.formData,
  });
  // Calls this exact token rather than /next, which auto-selects the oldest
  // waiting one — these tests need a deterministic subject.
  await api()
    .post(`/api/tokens/${token.id}/call`)
    .set('Authorization', `Bearer ${org.accessToken}`)
    .send({ counterId: org.counter.id });
  await startToken(org.accessToken, token.id, token.deviceIdentifier);
  await api()
    .post(`/api/tokens/${token.id}/complete`)
    .set('Authorization', `Bearer ${org.accessToken}`);
  return token;
}

function listHistory(accessToken: string, query = '') {
  return api()
    .get(`/api/service-history${query}`)
    .set('Authorization', `Bearer ${accessToken}`);
}

describe('GET /api/service-history', () => {
  it('returns COMPLETED visits by default, with the served details staff need', async () => {
    const org = await setupOrg();
    await setFormFields(org.accessToken, org.queue.id, [
      { key: 'full_name', label: 'Full Name', type: 'text', required: true },
    ]);
    const token = await completeOneToken(org, {
      deviceIdentifier: 'pixel-alpha-001',
      formData: { full_name: 'Amina Rahman' },
    });

    const res = await listHistory(org.accessToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const [entry] = res.body.data;
    expect(entry.serialNumber).toBe(token.serialNumber);
    expect(entry.status).toBe('COMPLETED');
    expect(entry.deviceIdentifier).toBe('pixel-alpha-001');
    expect(entry.queue.name).toBe('Front Desk');
    expect(entry.services.map((s: { name: string }) => s.name)).toEqual(['Passport Renewal']);
    expect(entry.counter.name).toBe('Counter 1');
    expect(entry.formFields).toEqual([
      { key: 'full_name', label: 'Full Name', type: 'text', value: 'Amina Rahman' },
    ]);
    expect(entry.startedAt).not.toBeNull();
    expect(entry.completedAt).not.toBeNull();
    expect(entry.actualDurationMinutes).not.toBeNull();
  });

  it('never exposes the service-start OTP columns', async () => {
    const org = await setupOrg();
    await completeOneToken(org);

    const res = await listHistory(org.accessToken);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/serviceStartOtp/i);
    expect(serialized).not.toMatch(/otpCipher/i);
  });

  it('excludes a still-waiting token — service has not been given yet', async () => {
    const org = await setupOrg();
    await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const res = await listHistory(org.accessToken);

    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('does not count a cancelled visit as service given, but can list it on request', async () => {
    const org = await setupOrg();
    const cancelled = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await api()
      .post(`/api/tokens/${cancelled.id}/cancel`)
      .send({ deviceIdentifier: cancelled.deviceIdentifier });

    const completedOnly = await listHistory(org.accessToken);
    expect(completedOnly.body.data).toHaveLength(0);

    const cancelledOnly = await listHistory(org.accessToken, '?status=CANCELLED');
    expect(cancelledOnly.body.data).toHaveLength(1);
    expect(cancelledOnly.body.data[0].status).toBe('CANCELLED');
  });

  it('searches serial number, device identifier and queue name, case-insensitively', async () => {
    const org = await setupOrg();
    const wanted = await completeOneToken(org, { deviceIdentifier: 'pixel-alpha-001' });
    await completeOneToken(org, { deviceIdentifier: 'nokia-beta-002' });

    const byDevice = await listHistory(org.accessToken, '?search=ALPHA');
    expect(byDevice.body.data).toHaveLength(1);
    expect(byDevice.body.data[0].deviceIdentifier).toBe('pixel-alpha-001');

    const bySerial = await listHistory(org.accessToken, `?search=${wanted.serialNumber}`);
    expect(bySerial.body.data).toHaveLength(1);

    const byQueue = await listHistory(org.accessToken, '?search=front desk');
    expect(byQueue.body.data).toHaveLength(2);

    const noMatch = await listHistory(org.accessToken, '?search=zzz-nothing');
    expect(noMatch.body.data).toHaveLength(0);
    expect(noMatch.body.pagination.total).toBe(0);
  });

  it('paginates over the full matching set', async () => {
    const org = await setupOrg();
    await completeOneToken(org);
    await completeOneToken(org);
    await completeOneToken(org);

    const res = await listHistory(org.accessToken, '?pageSize=2&page=2');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it("never returns another organization's visits, even on an exact search match", async () => {
    const orgA = await setupOrg('Org A Desk');
    const orgB = await setupOrg('Confidential Clinic');
    await completeOneToken(orgB, { deviceIdentifier: 'other-org-device' });

    const unfiltered = await listHistory(orgA.accessToken);
    expect(unfiltered.body.data).toHaveLength(0);

    const searched = await listHistory(orgA.accessToken, '?search=other-org-device');
    expect(searched.body.data).toHaveLength(0);
    expect(searched.body.pagination.total).toBe(0);
  });

  it('requires authentication and the view_reports permission', async () => {
    const org = await setupOrg();

    const anonymous = await api().get('/api/service-history');
    expect(anonymous.status).toBe(401);

    // STAFF holds view_reports, so this is the positive control that the
    // route is permission-gated rather than owner-only.
    const staff = await createStaffWithRole(org.organizationId, 'STAFF');
    const asStaff = await listHistory(staff.accessToken);
    expect(asStaff.status).toBe(200);
  });

  it('rejects an over-long search term instead of querying with it', async () => {
    const org = await setupOrg();

    const res = await listHistory(org.accessToken, `?search=${'a'.repeat(201)}`);

    expect(res.status).toBe(422);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createRestrictedStaff, createService, createToken, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/reports', () => {
  it('counts tokens created within the default (today) range', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await createToken({ queueId: queue.id, serviceId: service.id });
    await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await api().get('/api/reports').set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tokensCreated).toBe(2);
    expect(res.body.data.tokensCompleted).toBe(0);
    expect(res.body.data.tokensSkipped).toBe(0);
    expect(Array.isArray(res.body.data.peakHours)).toBe(true);
    expect(Array.isArray(res.body.data.queuePerformance)).toBe(true);
    expect(res.body.data.queuePerformance[0]).toMatchObject({ queueId: queue.id, created: 2 });
  });

  it('accepts the last7/last30/yesterday presets', async () => {
    const ctx = await registerOwner();

    for (const range of ['yesterday', 'last7', 'last30']) {
      const res = await api()
        .get(`/api/reports?range=${range}`)
        .set('Authorization', `Bearer ${ctx.accessToken}`);
      expect(res.status).toBe(200);
    }
  });

  it('accepts a custom range with from/to', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .get('/api/reports?range=custom&from=2026-01-01&to=2026-01-31')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
  });

  it('rejects a custom range missing from/to', async () => {
    const ctx = await registerOwner();

    const res = await api()
      .get('/api/reports?range=custom')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(422);
  });

  it('requires authentication', async () => {
    const res = await api().get('/api/reports');
    expect(res.status).toBe(401);
  });

  it('allows ACCOUNTANT (view_reports is part of the frozen ACCOUNTANT policy)', async () => {
    const ctx = await registerOwner();
    const accountant = await createRestrictedStaff(ctx.organizationId);

    const res = await api().get('/api/reports').set('Authorization', `Bearer ${accountant.accessToken}`);

    expect(res.status).toBe(200);
  });

  it("does not mix another organization's tokens into the count", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const queueB = await createQueue(orgB.accessToken);
    const serviceB = await createService(orgB.accessToken, queueB.id);
    await createToken({ queueId: queueB.id, serviceId: serviceB.id });

    const res = await api().get('/api/reports').set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tokensCreated).toBe(0);
  });
});

describe('GET /api/reports/export', () => {
  it('returns a CSV file', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await createToken({ queueId: queue.id, serviceId: service.id });

    const res = await api()
      .get('/api/reports/export')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Tokens Created,1');
    expect(res.text).toContain('Queue Performance');
  });

  it('requires authentication', async () => {
    const res = await api().get('/api/reports/export');
    expect(res.status).toBe(401);
  });

  it('allows ACCOUNTANT (export_reports is part of the frozen ACCOUNTANT policy)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await createToken({ queueId: queue.id, serviceId: service.id });
    const accountant = await createRestrictedStaff(ctx.organizationId);

    const res = await api()
      .get('/api/reports/export')
      .set('Authorization', `Bearer ${accountant.accessToken}`);

    expect(res.status).toBe(200);
  });
});

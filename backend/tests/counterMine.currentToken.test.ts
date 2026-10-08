import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createStaffWithRole,
  createToken,
  registerOwner,
} from './helpers/app';
import { resetDb } from './helpers/db';

/**
 * ADR-072: GET /api/counters/mine also returns the person currently called to,
 * or being served at, the caller's own counter — read-only, minimal, and
 * straight from the database, so the Floating Counter Console never has to
 * work out "who is at my counter" from a paged list.
 */

beforeEach(async () => {
  await resetDb();
});

const bearer = (token: string) => `Bearer ${token}`;
const mine = (t: string) => api().get('/api/counters/mine').set('Authorization', bearer(t));
const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
  api().post(path).set('Authorization', bearer(t)).send(body);

const CURRENT_TOKEN_KEYS = [
  'calledAt',
  'id',
  'requiresVerificationCode',
  'serialNumber',
  'serviceName',
  'startedAt',
  'status',
  'step',
];

async function setup() {
  const owner = await registerOwner();
  const admin = await createStaffWithRole(owner.organizationId, 'ADMIN');
  const queue = await createQueue(owner.accessToken, { requireServiceStartOtp: false, adminId: admin.staffId });
  const intake = await createService(owner.accessToken, queue.id, { serviceName: 'Intake' });
  const payment = await createService(owner.accessToken, queue.id, { serviceName: 'Payment' });
  const counterA = await createCounter(owner.accessToken, queue.id, { name: 'Counter A', assignToCreator: false });
  const counterB = await createCounter(owner.accessToken, queue.id, { name: 'Counter B', assignToCreator: false });
  const exec = await createStaffWithRole(owner.organizationId, 'STAFF', { workspaceAdminId: admin.staffId });
  const other = await createStaffWithRole(owner.organizationId, 'STAFF', { workspaceAdminId: admin.staffId });
  for (const [counterId, staffId] of [
    [counterA.id, exec.staffId],
    [counterB.id, other.staffId],
  ]) {
    await api()
      .patch(`/api/counters/${counterId}/assign`)
      .set('Authorization', bearer(owner.accessToken))
      .send({ staffId });
    await api()
      .patch(`/api/counters/${counterId}/status`)
      .set('Authorization', bearer(owner.accessToken))
      .send({ status: 'ACTIVE' });
  }
  return { owner, admin, queue, intake, payment, counterA, counterB, exec, other };
}

describe('ADR-072 — GET /api/counters/mine reports the person at my counter', () => {
  it('is null while nobody is called to the counter', async () => {
    const org = await setup();
    const res = await mine(org.exec.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(org.counterA.id);
    expect(res.body.data.currentToken).toBeNull();
  });

  it('follows the token through CALLED and IN_PROGRESS, then clears when it completes', async () => {
    const org = await setup();
    const t = await createToken({
      queueId: org.queue.id,
      serviceId: org.intake.id,
      formData: {},
    });

    const called = await post(org.exec.accessToken, `/api/queues/${org.queue.id}/next`);
    expect(called.status).toBe(200);
    let cur = (await mine(org.exec.accessToken)).body.data.currentToken;
    expect(cur).toMatchObject({ id: t.id, status: 'CALLED', serviceName: 'Intake', requiresVerificationCode: false });
    expect(cur.serialNumber).toBe(called.body.data.serialNumber);
    expect(Date.parse(cur.calledAt)).not.toBeNaN();
    expect(cur.startedAt).toBeNull();

    expect((await post(org.exec.accessToken, `/api/tokens/${t.id}/start`)).status).toBe(200);
    cur = (await mine(org.exec.accessToken)).body.data.currentToken;
    expect(cur.status).toBe('IN_PROGRESS');
    expect(Date.parse(cur.startedAt)).not.toBeNaN();

    expect((await post(org.exec.accessToken, `/api/tokens/${t.id}/complete`)).status).toBe(200);
    expect((await mine(org.exec.accessToken)).body.data.currentToken).toBeNull();
  });

  it('on a journey, shows the current step’s service and its own times', async () => {
    const org = await setup();
    const t = await createToken({ queueId: org.queue.id, serviceIds: [org.intake.id, org.payment.id] });
    await post(org.exec.accessToken, `/api/queues/${org.queue.id}/next`);
    const cur = (await mine(org.exec.accessToken)).body.data.currentToken;
    expect(cur).toMatchObject({ id: t.id, serviceName: 'Intake', step: { number: 1, total: 2 } });
  });

  it('never shows a token at someone else’s counter', async () => {
    const org = await setup();
    await createToken({ queueId: org.queue.id, serviceId: org.intake.id });
    expect((await post(org.other.accessToken, `/api/queues/${org.queue.id}/next`)).status).toBe(200);
    expect((await mine(org.exec.accessToken)).body.data.currentToken).toBeNull();
    expect((await mine(org.other.accessToken)).body.data.currentToken).not.toBeNull();
  });

  it('carries only the minimal fields — no form answers, device or contact data', async () => {
    const org = await setup();
    await createToken({ queueId: org.queue.id, serviceId: org.intake.id });
    await post(org.exec.accessToken, `/api/queues/${org.queue.id}/next`);
    const cur = (await mine(org.exec.accessToken)).body.data.currentToken;
    expect(Object.keys(cur).sort()).toEqual(CURRENT_TOKEN_KEYS);
  });

  it('is still null for someone with no counter', async () => {
    const org = await setup();
    expect((await mine(org.owner.accessToken)).body.data).toBeNull();
  });
});

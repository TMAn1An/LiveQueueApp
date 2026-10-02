import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, createService, createToken, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import type { TokenStatus } from '@prisma/client';

/**
 * The Live Queue header reads `waitingCount` from GET /api/queues/:id. It was
 * only ever computed for the queue list, so the header always said
 * "0 people waiting". Both endpoints now share one grouped count.
 */

beforeEach(async () => {
  await resetDb();
});

async function setup() {
  const owner = await registerOwner();
  const queue = await createQueue(owner.accessToken, { requireServiceStartOtp: false });
  const service = await createService(owner.accessToken, queue.id);
  const join = () => createToken({ queueId: queue.id, serviceId: service.id });
  return { owner, queue, service, join };
}

async function waitingCount(accessToken: string, queueId: string): Promise<number> {
  const res = await api().get(`/api/queues/${queueId}`).set('Authorization', `Bearer ${accessToken}`);
  expect(res.status).toBe(200);
  return res.body.data.waitingCount as number;
}

async function listedCount(accessToken: string, queueId: string): Promise<number> {
  const res = await api().get('/api/queues').set('Authorization', `Bearer ${accessToken}`);
  return (res.body.data as { id: string; waitingCount: number }[]).find((q) => q.id === queueId)!.waitingCount;
}

const setStatus = (id: string, status: TokenStatus) => prisma.token.update({ where: { id }, data: { status } });

describe('GET /api/queues/:id — waitingCount', () => {
  it('is 0, 1, then many as people join', async () => {
    const { owner, queue, join } = await setup();
    expect(await waitingCount(owner.accessToken, queue.id)).toBe(0);
    await join();
    expect(await waitingCount(owner.accessToken, queue.id)).toBe(1);
    await join();
    await join();
    expect(await waitingCount(owner.accessToken, queue.id)).toBe(3);
    expect(await listedCount(owner.accessToken, queue.id)).toBe(3);
  });

  it('does not count CALLED or IN_PROGRESS people', async () => {
    const { owner, queue, join } = await setup();
    const called = await join();
    const serving = await join();
    await join();
    await setStatus(called.id, 'CALLED');
    await setStatus(serving.id, 'IN_PROGRESS');
    expect(await waitingCount(owner.accessToken, queue.id)).toBe(1);
  });

  it('does not count completed, skipped or cancelled people', async () => {
    const { owner, queue, join } = await setup();
    const statuses: TokenStatus[] = ['COMPLETED', 'SKIPPED', 'CANCELLED'];
    for (const status of statuses) {
      await setStatus((await join()).id, status);
    }
    await join();
    expect(await waitingCount(owner.accessToken, queue.id)).toBe(1);
  });

  it('does not count someone booked into a session that has not started (ADR-048)', async () => {
    const { owner, queue, join } = await setup();
    const later = await join();
    await join();
    await prisma.token.update({
      where: { id: later.id },
      data: { assignedSessionStartsAt: new Date(Date.now() + 3 * 60 * 60_000) },
    });
    expect(await waitingCount(owner.accessToken, queue.id)).toBe(1);
    expect(await listedCount(owner.accessToken, queue.id)).toBe(1);

    // Once that session has started they are in the line and counted.
    await prisma.token.update({
      where: { id: later.id },
      data: { assignedSessionStartsAt: new Date(Date.now() - 60_000) },
    });
    expect(await waitingCount(owner.accessToken, queue.id)).toBe(2);
  });

  it('counts each queue on its own, and never another organization’s', async () => {
    const a = await setup();
    const otherQueue = await createQueue(a.owner.accessToken, { name: 'Second line', tokenPrefix: 'B' });
    const otherService = await createService(a.owner.accessToken, otherQueue.id);
    await a.join();
    await createToken({ queueId: otherQueue.id, serviceId: otherService.id });
    await createToken({ queueId: otherQueue.id, serviceId: otherService.id });
    const b = await setup();
    await b.join();

    expect(await waitingCount(a.owner.accessToken, a.queue.id)).toBe(1);
    expect(await waitingCount(a.owner.accessToken, otherQueue.id)).toBe(2);
    expect(await waitingCount(b.owner.accessToken, b.queue.id)).toBe(1);
    const foreign = await api().get(`/api/queues/${b.queue.id}`).set('Authorization', `Bearer ${a.owner.accessToken}`);
    expect(foreign.status).toBe(404);
  });
});

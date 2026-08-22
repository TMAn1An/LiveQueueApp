import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Socket as ClientSocket } from 'socket.io-client';
import {
  api,
  createCounter,
  createQueue,
  createService,
  createToken,
  registerOwner,
  setCounterStatus,
} from './helpers/app';
import { resetDb } from './helpers/db';
import {
  closeSocketTestServer,
  collectEvents,
  connectClient,
  ensureSocketTestServer,
  joinQueue,
  joinToken,
  waitForConnect,
} from './helpers/socket';

let port: number;
const openSockets: ClientSocket[] = [];

beforeAll(async () => {
  port = await ensureSocketTestServer();
});

afterAll(async () => {
  await closeSocketTestServer();
});

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  for (const socket of openSockets.splice(0)) {
    socket.disconnect();
  }
});

function track(socket: ClientSocket): ClientSocket {
  openSockets.push(socket);
  return socket;
}

async function putFormFields(accessToken: string, queueId: string) {
  await api()
    .put(`/api/queues/${queueId}/form-fields`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ fields: [{ key: 'phone', label: 'Phone', type: 'phone', required: true }] });
}

async function patchQueueStatus(accessToken: string, queueId: string, status: string) {
  await api()
    .patch(`/api/queues/${queueId}/status`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ status });
}

async function callToken(accessToken: string, tokenId: string, counterId: string) {
  await api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

describe('Public room joins', () => {
  it('lets an anonymous client join a queue room', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const socket = track(connectClient(port));
    await waitForConnect(socket);

    const ack = await joinQueue(socket, queue.id);
    expect(ack.success).toBe(true);
  });

  it('lets an anonymous client join a token room', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    const socket = track(connectClient(port));
    await waitForConnect(socket);

    const ack = await joinToken(socket, token.id);
    expect(ack.success).toBe(true);
  });

  it('rejects joining a queue room for a non-existent queue', async () => {
    const socket = track(connectClient(port));
    await waitForConnect(socket);
    const ack = await joinQueue(socket, '00000000-0000-0000-0000-000000000000');
    expect(ack.success).toBe(false);
    expect(ack.error?.code).toBe('QUEUE_NOT_FOUND');
  });

  it('rejects joining a token room for a non-existent token', async () => {
    const socket = track(connectClient(port));
    await waitForConnect(socket);
    const ack = await joinToken(socket, '00000000-0000-0000-0000-000000000000');
    expect(ack.success).toBe(false);
    expect(ack.error?.code).toBe('TOKEN_NOT_FOUND');
  });
});

describe('Queue room never leaks token or counter detail', () => {
  it('never receives a token.created event, even with customer formData submitted', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await putFormFields(ctx.accessToken, queue.id);

    const socket = track(connectClient(port));
    await waitForConnect(socket);
    const ack = await joinQueue(socket, queue.id);
    expect(ack.success).toBe(true);

    const createdEvents = collectEvents(socket, 'token.created', 800);
    const anyTokenEvent = collectEvents(socket, 'token.called', 800);

    await createToken({
      queueId: queue.id,
      serviceId: service.id,
      formData: { phone: '555-0100' },
    });

    expect(await createdEvents).toHaveLength(0);
    expect(await anyTokenEvent).toHaveLength(0);
  });

  it('never receives counter.created / counter.status_changed events', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const socket = track(connectClient(port));
    await waitForConnect(socket);
    await joinQueue(socket, queue.id);

    const createdEvents = collectEvents(socket, 'counter.created', 800);
    const statusEvents = collectEvents(socket, 'counter.status_changed', 800);

    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    expect(await createdEvents).toHaveLength(0);
    expect(await statusEvents).toHaveLength(0);
  });

  it('only ever receives queue.status_changed, with a public-safe payload', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const socket = track(connectClient(port));
    await waitForConnect(socket);
    await joinQueue(socket, queue.id);

    const eventPromise = new Promise<{ data: Record<string, unknown> }>((resolve) => {
      socket.once('queue.status_changed', resolve);
    });

    await patchQueueStatus(ctx.accessToken, queue.id, 'PAUSED');

    const envelope = await eventPromise;
    expect(envelope.data).toEqual({ id: queue.id, status: 'PAUSED' });
    expect(envelope.data.tokenPrefix).toBeUndefined();
    expect(envelope.data.nextTokenNumber).toBeUndefined();
  });
});

describe('Token room isolation', () => {
  it("token A's room never receives token B's events", async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const tokenA = await createToken({ queueId: queue.id, serviceId: service.id });
    const tokenB = await createToken({ queueId: queue.id, serviceId: service.id });

    const socket = track(connectClient(port));
    await waitForConnect(socket);
    await joinToken(socket, tokenA.id);

    const events = collectEvents(socket, 'token.called', 800);

    await callToken(ctx.accessToken, tokenB.id, counter.id);

    expect(await events).toHaveLength(0);
  });

  it("a token's own room receives its own token.called event with the customer-safe view", async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    const socket = track(connectClient(port));
    await waitForConnect(socket);
    await joinToken(socket, token.id);

    const eventPromise = new Promise<{ data: Record<string, unknown> }>((resolve) => {
      socket.once('token.called', resolve);
    });

    await callToken(ctx.accessToken, token.id, counter.id);

    const envelope = await eventPromise;
    expect(envelope.data.status).toBe('CALLED');
    expect(envelope.data.organizationId).toBeUndefined();
    expect(envelope.data.deviceId).toBeUndefined();
    expect(envelope.data.idempotencyKey).toBeUndefined();
  });
});

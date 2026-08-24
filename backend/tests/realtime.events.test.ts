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
  connectClient,
  ensureSocketTestServer,
  joinOrganization,
  waitForConnect,
  waitForEvent,
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

async function orgSocket(accessToken: string, organizationId: string): Promise<ClientSocket> {
  const socket = track(connectClient(port, accessToken));
  await waitForConnect(socket);
  const ack = await joinOrganization(socket, organizationId);
  if (!ack.success) throw new Error(`join:organization failed: ${JSON.stringify(ack)}`);
  return socket;
}

interface Envelope {
  type: string;
  organizationId: string;
  queueId?: string;
  tokenId?: string;
  data: Record<string, unknown>;
}

describe('All 12 specification events are emitted to the organization room', () => {
  it('queue.created', async () => {
    const ctx = await registerOwner();
    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'queue.created');

    await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Q1', tokenPrefix: 'A' });

    const envelope = await eventPromise;
    expect(envelope.organizationId).toBe(ctx.organizationId);
    expect(envelope.data.name).toBe('Q1');
  });

  it('queue.updated', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'queue.updated');

    await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed' });

    const envelope = await eventPromise;
    expect(envelope.data.name).toBe('Renamed');
  });

  it('queue.status_changed (organization room gets full detail)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'queue.status_changed');

    await api()
      .patch(`/api/queues/${queue.id}/status`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ status: 'PAUSED' });

    const envelope = await eventPromise;
    expect(envelope.data.status).toBe('PAUSED');
    expect(envelope.data.id).toBe(queue.id);
    expect(envelope.data.organizationId).toBe(ctx.organizationId); // full detail here, unlike the queue room
  });

  it('counter.created', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'counter.created');

    await createCounter(ctx.accessToken, queue.id, { name: 'Counter 1' });

    const envelope = await eventPromise;
    expect(envelope.data.name).toBe('Counter 1');
    expect(envelope.queueId).toBe(queue.id);
  });

  it('counter.updated', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'counter.updated');

    await api()
      .put(`/api/counters/${counter.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Renamed Counter' });

    const envelope = await eventPromise;
    expect(envelope.data.name).toBe('Renamed Counter');
  });

  it('counter.status_changed', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const counter = await createCounter(ctx.accessToken, queue.id);
    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'counter.status_changed');

    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const envelope = await eventPromise;
    expect(envelope.data.status).toBe('ACTIVE');
  });

  it('token.created', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'token.created');

    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    const envelope = await eventPromise;
    expect(envelope.tokenId).toBe(token.id);
    expect(envelope.data.status).toBe('WAITING');
    expect(envelope.data.organizationId).toBe(ctx.organizationId); // full staff detail
  });

  it('token.called', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'token.called');

    await api()
      .post(`/api/tokens/${token.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });

    const envelope = await eventPromise;
    expect(envelope.data.status).toBe('CALLED');
  });

  it('token.called (via recall — reuses the same event, no new event type)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    await api()
      .post(`/api/tokens/${token.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });
    await api().post(`/api/tokens/${token.id}/skip`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'token.called');

    await api()
      .post(`/api/tokens/${token.id}/recall`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });

    const envelope = await eventPromise;
    expect(envelope.tokenId).toBe(token.id);
    expect(envelope.data.status).toBe('CALLED');
  });

  it('token.started', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    await api()
      .post(`/api/tokens/${token.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });

    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'token.started');

    await api().post(`/api/tokens/${token.id}/start`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const envelope = await eventPromise;
    expect(envelope.data.status).toBe('IN_PROGRESS');
  });

  it('token.completed', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: queue.id, serviceId: service.id });
    await api()
      .post(`/api/tokens/${token.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });
    await api().post(`/api/tokens/${token.id}/start`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'token.completed');

    await api().post(`/api/tokens/${token.id}/complete`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const envelope = await eventPromise;
    expect(envelope.data.status).toBe('COMPLETED');
  });

  it('token.skipped', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const token = await createToken({ queueId: queue.id, serviceId: service.id });

    const socket = await orgSocket(ctx.accessToken, ctx.organizationId);
    const eventPromise = waitForEvent<Envelope>(socket, 'token.skipped');

    await api().post(`/api/tokens/${token.id}/skip`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const envelope = await eventPromise;
    expect(envelope.data.status).toBe('SKIPPED');
  });
});

describe('Multiple clients in the same organization', () => {
  it('both staff sockets receive the same event', async () => {
    const ctx = await registerOwner();
    const socketA = await orgSocket(ctx.accessToken, ctx.organizationId);
    const socketB = await orgSocket(ctx.accessToken, ctx.organizationId);

    const eventA = waitForEvent<Envelope>(socketA, 'queue.created');
    const eventB = waitForEvent<Envelope>(socketB, 'queue.created');

    await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'Shared Queue', tokenPrefix: 'A' });

    const [envelopeA, envelopeB] = await Promise.all([eventA, eventB]);
    expect(envelopeA.data.name).toBe('Shared Queue');
    expect(envelopeB.data.name).toBe('Shared Queue');
  });

  it("isolated organizations never receive each other's events", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const socketA = await orgSocket(orgA.accessToken, orgA.organizationId);
    const socketB = await orgSocket(orgB.accessToken, orgB.organizationId);

    const eventA = waitForEvent<Envelope>(socketA, 'queue.created');
    let orgBReceived = false;
    socketB.once('queue.created', () => {
      orgBReceived = true;
    });

    await api()
      .post('/api/queues')
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ name: 'Org A Queue', tokenPrefix: 'A' });

    await eventA;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(orgBReceived).toBe(false);
  });
});

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
  joinToken,
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

interface PositionEnvelope {
  tokenId: string;
  data: {
    estimatedWaitMinutes: number | null;
    estimatedReadyAt: string | null;
    etaUnavailableReason: string | null;
  };
}

async function setupQueue() {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken);
  const service = await createService(ctx.accessToken, queue.id, { durationMinutes: 10 });
  return { ...ctx, queue, service };
}

/** Same route as staff use, without a token — the service layer decides to
 * return the customer-safe view when the request is unauthenticated. */
function getCustomerToken(tokenId: string) {
  return api().get(`/api/tokens/${tokenId}`);
}

describe('ETA availability', () => {
  it('reports no estimate, and says why, when no counter is active', async () => {
    const org = await setupQueue();
    await createCounter(org.accessToken, org.queue.id); // created OFFLINE
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const res = await api()
      .get(`/api/tokens/${token.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.estimatedReadyAt).toBeNull();
    expect(res.body.data.estimatedWaitMinutes).toBeNull();
    // Never invented: no serving capacity means no honest number.
    expect(res.body.data.etaUnavailableReason).toBe('NO_ACTIVE_COUNTER');
  });

  it('produces an estimate as soon as one counter is active', async () => {
    const org = await setupQueue();
    const counter = await createCounter(org.accessToken, org.queue.id);
    await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const res = await api()
      .get(`/api/tokens/${token.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    expect(res.body.data.estimatedReadyAt).not.toBeNull();
    expect(res.body.data.etaUnavailableReason).toBeNull();
  });

  it('gives a later customer a longer estimate than the one ahead of them', async () => {
    const org = await setupQueue();
    const counter = await createCounter(org.accessToken, org.queue.id);
    await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const second = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const [firstRes, secondRes] = await Promise.all([
      api().get(`/api/tokens/${first.id}`).set('Authorization', `Bearer ${org.accessToken}`),
      api().get(`/api/tokens/${second.id}`).set('Authorization', `Bearer ${org.accessToken}`),
    ]);

    expect(new Date(secondRes.body.data.estimatedReadyAt).getTime()).toBeGreaterThan(
      new Date(firstRes.body.data.estimatedReadyAt).getTime(),
    );
  });

  it('serves two customers in parallel when two counters are active', async () => {
    const org = await setupQueue();
    for (let i = 0; i < 2; i++) {
      const counter = await createCounter(org.accessToken, org.queue.id, { name: `C${i}` });
      await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
    }
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const second = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const [firstRes, secondRes] = await Promise.all([
      api().get(`/api/tokens/${first.id}`).set('Authorization', `Bearer ${org.accessToken}`),
      api().get(`/api/tokens/${second.id}`).set('Authorization', `Bearer ${org.accessToken}`),
    ]);

    // Both land on a free counter immediately, so neither waits for the other.
    expect(firstRes.body.data.estimatedWaitMinutes).toBe(0);
    expect(secondRes.body.data.estimatedWaitMinutes).toBe(0);
  });

  it('exposes the reason to the customer view too, not just to staff', async () => {
    const org = await setupQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const res = await getCustomerToken(token.id);

    expect(res.status).toBe(200);
    expect(res.body.data.etaUnavailableReason).toBe('NO_ACTIVE_COUNTER');
  });

  /**
   * The defect this checkpoint fixes: a customer who joined while nothing was
   * open used to keep seeing "no estimate" after staff opened a counter,
   * because activating one told the staff dashboard and nobody else.
   */
  it('pushes a fresh estimate to waiting customers when a counter is activated', async () => {
    const org = await setupQueue();
    const counter = await createCounter(org.accessToken, org.queue.id);
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const socket = track(connectClient(port));
    await waitForConnect(socket);
    await joinToken(socket, token.id);

    const eventPromise = waitForEvent<PositionEnvelope>(socket, 'token.position_changed');
    await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');

    const event = await eventPromise;
    expect(event.tokenId).toBe(token.id);
    expect(event.data.estimatedReadyAt).not.toBeNull();
    expect(event.data.etaUnavailableReason).toBeNull();
  });

  it('tells waiting customers the estimate is gone when the last counter closes', async () => {
    const org = await setupQueue();
    const counter = await createCounter(org.accessToken, org.queue.id);
    await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const socket = track(connectClient(port));
    await waitForConnect(socket);
    await joinToken(socket, token.id);

    const eventPromise = waitForEvent<PositionEnvelope>(socket, 'token.position_changed');
    await setCounterStatus(org.accessToken, counter.id, 'OFFLINE');

    const event = await eventPromise;
    expect(event.data.estimatedReadyAt).toBeNull();
    expect(event.data.etaUnavailableReason).toBe('NO_ACTIVE_COUNTER');
  });
});

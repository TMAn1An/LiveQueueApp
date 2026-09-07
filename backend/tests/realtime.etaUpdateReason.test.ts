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
  collectEvents,
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
    position: number;
    estimatedWaitMinutes: number | null;
    estimatedReadyAt: string | null;
    reason?: string;
  };
}

/**
 * The customer app shows an "estimated time updated" notice only for an
 * explicit staff service-time change — never for ordinary queue movement.
 * That distinction lives entirely in this `reason` field, so it is worth
 * pinning down precisely.
 */
describe('token.position_changed — ETA update reason', () => {
  async function setupQueueWithTwoWaitingTokens() {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });
    return { ctx, queue, service, counter, first, second };
  }

  it("tags the broadcast with 'duration_updated' when staff change a required duration", async () => {
    const { ctx, counter, first, second } = await setupQueueWithTwoWaitingTokens();

    // The duration override is only valid on an active (CALLED) token, so
    // the change is made to the first token and observed by the second,
    // which is the customer whose wait actually moves.
    await api()
      .post(`/api/tokens/${first.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });

    const socket = track(connectClient(port));
    await waitForConnect(socket);
    await joinToken(socket, second.id);

    // The call above broadcasts its own (reasonless) recalculation *after*
    // sending its HTTP response, so it can land once this socket has already
    // joined. Drained here so the assertion below is about the duration
    // change and not about whichever event happened to arrive first.
    await collectEvents(socket, 'token.position_changed', 300);

    const eventPromise = waitForEvent<PositionEnvelope>(socket, 'token.position_changed');
    const res = await api()
      .patch(`/api/tokens/${first.id}/duration`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ requiredDurationMinutes: 45 });
    expect(res.status).toBe(200);

    const event = await eventPromise;
    expect(event.tokenId).toBe(second.id);
    expect(event.data.reason).toBe('duration_updated');
    expect(event.data.estimatedReadyAt).not.toBeNull();
  });

  it('carries no reason for ordinary queue movement', async () => {
    const { ctx, counter, first, second } = await setupQueueWithTwoWaitingTokens();

    const socket = track(connectClient(port));
    await waitForConnect(socket);
    await joinToken(socket, second.id);

    // Calling a token ahead moves the queue and recomputes every ETA, but no
    // staff member changed how long anything takes — so no notice is owed.
    const eventPromise = waitForEvent<PositionEnvelope>(socket, 'token.position_changed');
    await api()
      .post(`/api/tokens/${first.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });

    const event = await eventPromise;
    expect(event.data.reason).toBeUndefined();
  });
});

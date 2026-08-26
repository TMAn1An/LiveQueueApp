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
  data: { position: number; estimatedWaitMinutes: number | null };
}

describe('token.position_changed — targeted per-token emission', () => {
  it('waiting tokens behind the called token receive position_changed; the called token itself does not', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });
    const third = await createToken({ queueId: queue.id, serviceId: service.id });

    const socketFirst = track(connectClient(port));
    const socketSecond = track(connectClient(port));
    const socketThird = track(connectClient(port));
    await Promise.all([waitForConnect(socketFirst), waitForConnect(socketSecond), waitForConnect(socketThird)]);
    await Promise.all([
      joinToken(socketFirst, first.id),
      joinToken(socketSecond, second.id),
      joinToken(socketThird, third.id),
    ]);

    const firstEvents = collectEvents<PositionEnvelope>(socketFirst, 'token.position_changed', 800);
    const secondEvent = waitForEvent<PositionEnvelope>(socketSecond, 'token.position_changed');
    const thirdEvent = waitForEvent<PositionEnvelope>(socketThird, 'token.position_changed');

    await api()
      .post(`/api/tokens/${first.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });

    // Tokens behind the one that was called shift up by exactly one position.
    const secondEnvelope = await secondEvent;
    expect(secondEnvelope.tokenId).toBe(second.id);
    expect(secondEnvelope.data.position).toBe(1);

    const thirdEnvelope = await thirdEvent;
    expect(thirdEnvelope.tokenId).toBe(third.id);
    expect(thirdEnvelope.data.position).toBe(2);

    // The token that was actually called never receives position_changed —
    // it's no longer WAITING, and it already got token.called.
    expect(await firstEvents).toHaveLength(0);
  });

  it('a token ahead of the one that changed status receives nothing', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });

    const socketFirst = track(connectClient(port));
    await waitForConnect(socketFirst);
    await joinToken(socketFirst, first.id);

    const firstEvents = collectEvents<PositionEnvelope>(socketFirst, 'token.position_changed', 800);

    // Call the SECOND token (skipping ahead via a direct call) — the first
    // token, still WAITING and still ahead in sequence, is unaffected.
    await api()
      .post(`/api/tokens/${second.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });

    expect(await firstEvents).toHaveLength(0);
  });

  it('a WAITING -> SKIPPED transition triggers position_changed for tokens behind it', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });

    const socketSecond = track(connectClient(port));
    await waitForConnect(socketSecond);
    await joinToken(socketSecond, second.id);
    const eventPromise = waitForEvent<PositionEnvelope>(socketSecond, 'token.position_changed');

    await api().post(`/api/tokens/${first.id}/skip`).set('Authorization', `Bearer ${ctx.accessToken}`);

    const envelope = await eventPromise;
    expect(envelope.data.position).toBe(1);
  });

  it('a CALLED -> SKIPPED transition DOES trigger position_changed (V2 Checkpoint 4: it frees a counter, shifting ETAs)', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });

    const socketSecond = track(connectClient(port));
    await waitForConnect(socketSecond);
    await joinToken(socketSecond, second.id);

    // Calling `first` legitimately shifts `second`'s position (WAITING ->
    // CALLED). Explicitly wait for and consume that expected event first,
    // so its background emission (which runs after the HTTP response) can't
    // race into the window set up for the skip step below.
    const callPositionEvent = waitForEvent<PositionEnvelope>(socketSecond, 'token.position_changed');
    await api()
      .post(`/api/tokens/${first.id}/call`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });
    await callPositionEvent;

    // first is now CALLED, occupying the only active counter — second's
    // *position* (1) won't change when first is skipped, but the counter
    // it was occupying becomes free again, which does change second's
    // simulated ETA (V2 Checkpoint 4, ADR-026: the broadcast is no longer
    // scoped to "only tokens whose position shifted").
    const skipPositionEvent = waitForEvent<PositionEnvelope>(socketSecond, 'token.position_changed');
    await api().post(`/api/tokens/${first.id}/skip`).set('Authorization', `Bearer ${ctx.accessToken}`);
    const envelope = await skipPositionEvent;

    expect(envelope.data.position).toBe(1);
  });

  it('/next triggers position_changed for tokens behind the auto-selected token', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    const counter = await createCounter(ctx.accessToken, queue.id);
    await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');

    const first = await createToken({ queueId: queue.id, serviceId: service.id });
    const second = await createToken({ queueId: queue.id, serviceId: service.id });

    const socketSecond = track(connectClient(port));
    await waitForConnect(socketSecond);
    await joinToken(socketSecond, second.id);
    const eventPromise = waitForEvent<PositionEnvelope>(socketSecond, 'token.position_changed');

    const nextRes = await api()
      .post(`/api/queues/${queue.id}/next`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ counterId: counter.id });
    expect(nextRes.body.data.id).toBe(first.id);

    const envelope = await eventPromise;
    expect(envelope.tokenId).toBe(second.id);
    expect(envelope.data.position).toBe(1);
  });
});

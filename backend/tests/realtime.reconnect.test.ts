import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { api, createQueue, registerOwner } from './helpers/app';
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

async function createQueueViaRest(accessToken: string, name: string) {
  await api()
    .post('/api/queues')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name, tokenPrefix: 'A' });
}

describe('Reconnection', () => {
  it('a reconnected socket does not automatically retain its previous room membership', async () => {
    const ctx = await registerOwner();

    const first = track(connectClient(port, ctx.accessToken));
    await waitForConnect(first);
    const ack1 = await joinOrganization(first, ctx.organizationId);
    expect(ack1.success).toBe(true);

    // Simulate a disconnect + reconnect: this test's client disables
    // auto-reconnect, so a genuine reconnect looks like a brand new
    // connection from the server's perspective — exactly what the approved
    // design relies on (no server-side session persists across the gap).
    first.disconnect();

    const second = track(connectClient(port, ctx.accessToken));
    await waitForConnect(second);

    let received = false;
    second.once('queue.created', () => {
      received = true;
    });

    await createQueueViaRest(ctx.accessToken, 'Missed While Reconnecting');
    await new Promise((resolve) => setTimeout(resolve, 300));

    // No event replay, and no automatic re-join: the new connection must
    // explicitly re-join before it receives anything (approved decision 7).
    expect(received).toBe(false);
  });

  it('re-authenticating and re-joining after reconnect restores live delivery', async () => {
    const ctx = await registerOwner();

    const first = track(connectClient(port, ctx.accessToken));
    await waitForConnect(first);
    await joinOrganization(first, ctx.organizationId);
    first.disconnect();

    const second = track(connectClient(port, ctx.accessToken));
    await waitForConnect(second);
    const ack = await joinOrganization(second, ctx.organizationId);
    expect(ack.success).toBe(true);

    const eventPromise = waitForEvent(second, 'queue.created');
    await createQueueViaRest(ctx.accessToken, 'Received After Rejoin');

    await expect(eventPromise).resolves.toBeDefined();
  });

  it('resynchronization after reconnect is a REST concern, not a socket replay concern', async () => {
    // The token status endpoint (already built in Phase 3) is exactly what
    // approved decision 7 expects a reconnecting client to call — proving it
    // still works standalone, with no dependency on any socket state.
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api().get(`/api/queues/${queue.id}`).set('Authorization', `Bearer ${ctx.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(queue.id);
  });
});

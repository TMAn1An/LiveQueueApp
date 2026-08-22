import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createQueue, createService, createTokenRequest, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import {
  closeSocketTestServer,
  collectEvents,
  connectClient,
  ensureSocketTestServer,
  joinOrganization,
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

interface TokenCreatedEnvelope {
  tokenId: string;
  data: { id: string; sequenceNumber: number };
}

describe('Concurrent token creation — realtime event delivery', () => {
  it(
    '10 simultaneous token creates against the same queue produce exactly 10 token.created events, no duplicates, no gaps',
    async () => {
      const ctx = await registerOwner();
      const queue = await createQueue(ctx.accessToken);
      const service = await createService(ctx.accessToken, queue.id);

      const socket = track(connectClient(port, ctx.accessToken));
      await waitForConnect(socket);
      const ack = await joinOrganization(socket, ctx.organizationId);
      expect(ack.success).toBe(true);

      const eventsPromise = collectEvents<TokenCreatedEnvelope>(socket, 'token.created', 2000);

      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          createTokenRequest({
            queueId: queue.id,
            serviceId: service.id,
            deviceIdentifier: `device-${Math.random().toString(36).slice(2, 12)}`,
          }),
        ),
      );
      for (const res of responses) expect(res.status).toBe(201);

      const events = await eventsPromise;
      expect(events).toHaveLength(10);

      const tokenIds = new Set(events.map((e) => e.tokenId));
      expect(tokenIds.size).toBe(10); // no duplicate events for the same token

      const sequenceNumbers = events.map((e) => e.data.sequenceNumber).sort((a, b) => a - b);
      expect(sequenceNumbers).toEqual(Array.from({ length: 10 }, (_, i) => i + 1)); // no gaps, no dupes
    },
    20000,
  );
});

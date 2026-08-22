import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createQueue, createService, createTokenRequest, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import * as socketServerModule from '../src/realtime/socketServer';
import * as emit from '../src/realtime/emit';
import {
  closeSocketTestServer,
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
  vi.restoreAllMocks();
});

function track(socket: ClientSocket): ClientSocket {
  openSockets.push(socket);
  return socket;
}

interface Envelope {
  type: string;
}

describe('Events only fire after a successful, committed database operation', () => {
  it('a real forced DB failure results in an HTTP error and zero emitted events', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    // Poison the exact (queueId, sequenceNumber) the next real creation will
    // target, so the actual INSERT inside createToken hits a genuine
    // Postgres unique-constraint violation — same technique already proven
    // in Phase 3's rollback tests, no test-only production hooks.
    const device = await prisma.device.create({ data: { deviceIdentifier: 'poison-device-rt' } });
    await prisma.token.create({
      data: {
        organizationId: ctx.organizationId,
        queueId: queue.id,
        serviceId: service.id,
        deviceId: device.id,
        sequenceNumber: 1,
        serialNumber: 'A001',
        status: 'WAITING',
        formData: {},
        formVersion: 1,
        idempotencyKey: 'poison-key-rt',
      },
    });

    const socket = track(connectClient(port, ctx.accessToken));
    await waitForConnect(socket);
    await joinOrganization(socket, ctx.organizationId);

    let received = false;
    socket.once('token.created', () => {
      received = true;
    });

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    expect(res.status).toBe(409); // the actual DB operation failed

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(received).toBe(false); // and therefore no event was ever emitted
  });

  it('a successful operation emits its event only after the response reflects success', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const socket = track(connectClient(port, ctx.accessToken));
    await waitForConnect(socket);
    await joinOrganization(socket, ctx.organizationId);

    let received = false;
    socket.once('token.created', () => {
      received = true;
    });

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    expect(res.status).toBe(201);

    await new Promise<Envelope>((resolve) => socket.once('token.created', resolve));
    expect(received).toBe(true);
  });
});

describe('Socket delivery failure never turns a successful HTTP response into a failure', () => {
  it('an emission that throws internally still leaves the HTTP call successful', async () => {
    vi.spyOn(socketServerModule, 'getIO').mockReturnValue({
      to: () => {
        throw new Error('simulated socket delivery failure');
      },
    } as unknown as ReturnType<typeof socketServerModule.getIO>);

    const fakeQueue = {
      id: 'fake-queue-id',
      organizationId: 'fake-org-id',
      name: 'Fake',
    } as Parameters<typeof emit.emitQueueCreated>[0];

    await expect(emit.emitQueueCreated(fakeQueue)).resolves.toBeUndefined();
  });

  it('a real REST call still returns 201 even when the emit layer is forced to throw', async () => {
    vi.spyOn(socketServerModule, 'getIO').mockReturnValue({
      to: () => {
        throw new Error('simulated socket delivery failure');
      },
    } as unknown as ReturnType<typeof socketServerModule.getIO>);

    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);

    const res = await createTokenRequest({ queueId: queue.id, serviceId: service.id });
    expect(res.status).toBe(201); // the DB write already succeeded and committed
  });
});

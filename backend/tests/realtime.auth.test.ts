import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import {
  closeSocketTestServer,
  connectClient,
  ensureSocketTestServer,
  joinOrganization,
  waitForConnect,
  waitForConnectError,
} from './helpers/socket';
import type { Socket as ClientSocket } from 'socket.io-client';

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

describe('Socket handshake authentication', () => {
  it('allows an anonymous connection with no token', async () => {
    const socket = track(connectClient(port));
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
  });

  it('connects a socket with a valid staff JWT', async () => {
    const ctx = await registerOwner();
    const socket = track(connectClient(port, ctx.accessToken));
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
  });

  it('rejects the handshake for an invalid JWT', async () => {
    const socket = track(connectClient(port, 'not-a-real-token'));
    const err = await waitForConnectError(socket);
    expect(err.message).toBe('UNAUTHENTICATED');
  });

  it('rejects the handshake for an expired JWT', async () => {
    const ctx = await registerOwner();
    const expiredToken = jwt.sign(
      { sub: ctx.staffId, organizationId: ctx.organizationId, role: 'OWNER' },
      process.env.JWT_SECRET as string,
      { expiresIn: -10 },
    );
    const socket = track(connectClient(port, expiredToken));
    const err = await waitForConnectError(socket);
    expect(err.message).toBe('UNAUTHENTICATED');
  });

  it('rejects the handshake for a suspended staff member', async () => {
    const ctx = await registerOwner();
    await prisma.staff.update({ where: { id: ctx.staffId }, data: { status: 'SUSPENDED' } });

    const socket = track(connectClient(port, ctx.accessToken));
    const err = await waitForConnectError(socket);
    expect(err.message).toBe('UNAUTHENTICATED');
  });

  it('rejects the handshake when the organization is suspended', async () => {
    const ctx = await registerOwner();
    await prisma.organization.update({
      where: { id: ctx.organizationId },
      data: { status: 'SUSPENDED' },
    });

    const socket = track(connectClient(port, ctx.accessToken));
    const err = await waitForConnectError(socket);
    expect(err.message).toBe('UNAUTHENTICATED');
  });
});

describe('Organization room isolation', () => {
  it('lets a staff socket join its own organization room', async () => {
    const ctx = await registerOwner();
    const socket = track(connectClient(port, ctx.accessToken));
    await waitForConnect(socket);

    const ack = await joinOrganization(socket, ctx.organizationId);
    expect(ack.success).toBe(true);
  });

  it("rejects an Org A staff socket joining Org B's room", async () => {
    const orgA = await registerOwner({ organizationName: 'Org A' });
    const orgB = await registerOwner({ organizationName: 'Org B' });
    const socket = track(connectClient(port, orgA.accessToken));
    await waitForConnect(socket);

    const ack = await joinOrganization(socket, orgB.organizationId);
    expect(ack.success).toBe(false);
    expect(ack.error?.code).toBe('FORBIDDEN');
  });

  it('rejects an anonymous socket joining any organization room', async () => {
    const ctx = await registerOwner();
    const socket = track(connectClient(port));
    await waitForConnect(socket);

    const ack = await joinOrganization(socket, ctx.organizationId);
    expect(ack.success).toBe(false);
    expect(ack.error?.code).toBe('UNAUTHENTICATED');
  });
});

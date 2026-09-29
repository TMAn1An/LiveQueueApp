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

interface TokenEnvelope {
  tokenId: string;
  data: Record<string, unknown> & { status: string; serviceStartVerificationRequired: boolean };
}

async function calledCustomer(queueOverrides: Record<string, unknown>) {
  const owner = await registerOwner();
  const queue = await createQueue(owner.accessToken, queueOverrides);
  const service = await createService(owner.accessToken, queue.id);
  const counter = await createCounter(owner.accessToken, queue.id);
  await setCounterStatus(owner.accessToken, counter.id, 'ACTIVE');
  const token = await createToken({ queueId: queue.id, serviceId: service.id });

  // Joined before the call, and the call's own token.called consumed here:
  // the controller emits it after the HTTP response, so without this a
  // test could mistake that late event for the refresh it is waiting on.
  const customer = connectClient(port);
  openSockets.push(customer);
  await waitForConnect(customer);
  await joinToken(customer, token.id);
  const callEvent = waitForEvent<TokenEnvelope>(customer, 'token.called');
  await api()
    .post(`/api/tokens/${token.id}/call`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ counterId: counter.id });
  await callEvent;

  return { owner, queue, token, customer };
}

/**
 * ADR-041: a customer already CALLED sees the code card appear or disappear
 * with the setting, without reopening the app — the same token.called event
 * their screen already applies, carrying the fresh customer-safe view.
 */
describe('ADR-041 — a setting change reaches customers already at a counter', () => {
  it('turning the code OFF pushes serviceStartVerificationRequired=false to the CALLED token', async () => {
    const { owner, queue, token, customer } = await calledCustomer({});
    const pushed = waitForEvent<TokenEnvelope>(customer, 'token.called');

    await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ requireServiceStartOtp: false });

    const envelope = await pushed;
    expect(envelope.tokenId).toBe(token.id);
    expect(envelope.data.status).toBe('CALLED');
    expect(envelope.data.serviceStartVerificationRequired).toBe(false);
    expect(Object.keys(envelope.data).join(',')).not.toMatch(/otp|cipher/i);
  });

  it('turning the code ON pushes serviceStartVerificationRequired=true', async () => {
    const { owner, queue, customer } = await calledCustomer({ requireServiceStartOtp: false });
    const pushed = waitForEvent<TokenEnvelope>(customer, 'token.called');

    await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ requireServiceStartOtp: true });

    expect((await pushed).data.serviceStartVerificationRequired).toBe(true);
  });

  it('an edit that does not touch the setting re-sends nothing', async () => {
    const { owner, queue, customer } = await calledCustomer({});
    const events = collectEvents<TokenEnvelope>(customer, 'token.called', 500);

    await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Renamed' });

    expect(await events).toHaveLength(0);
  });
});

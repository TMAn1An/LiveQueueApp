import { beforeEach, describe, expect, it } from 'vitest';
import { api, createQueue, registerOwner } from './helpers/app';
import { resetDb } from './helpers/db';

beforeEach(async () => {
  await resetDb();
});

/**
 * The other half of the QR contract. The mobile parser's own tests pin the
 * shape it accepts (`livequeue://queue/{uuid}`); these pin the shape this
 * backend actually produces, and that the produced id really resolves
 * through the public endpoint the app calls straight after scanning. If the
 * two ever drift, one of these two suites fails instead of the scanner
 * silently doing nothing in a customer's hand.
 */
const QR_PAYLOAD_PATTERN =
  /^livequeue:\/\/queue\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('QR payload contract', () => {
  it('generates exactly the livequeue://queue/{uuid} shape the app parses', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    expect(queue.qrCodeUri).toMatch(QR_PAYLOAD_PATTERN);
    expect(queue.qrCodeUri).toBe(`livequeue://queue/${queue.id}`);
  });

  it('is the same value the dashboard reads back from the queue detail endpoint', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .get(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.qrCodeUri).toBe(queue.qrCodeUri);
  });

  it('carries a queue id the public config endpoint resolves without auth', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    // Exactly what the app does with the scanned value.
    const scannedId = queue.qrCodeUri.replace('livequeue://queue/', '');
    const res = await api().get(`/api/public/queues/${scannedId}/config`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(queue.id);
  });

  it('answers a well-formed but unknown queue id with QUEUE_NOT_FOUND, not a crash', async () => {
    const res = await api().get(
      '/api/public/queues/7f1c2b3a-9d4e-4c6f-8a1b-2c3d4e5f6a7b/config',
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUEUE_NOT_FOUND');
  });
});

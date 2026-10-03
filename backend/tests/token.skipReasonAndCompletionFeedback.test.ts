import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  assignCounterTo,
  createCounter,
  createQueue,
  createService,
  createStaffWithRole,
  createToken,
  registerOwner,
  setCounterStatus,
  startToken,
  servingToken,
  staffOf,
  queueAdmins,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import { normalizeOperatorText } from '../src/utils/skipReason';

/**
 * ADR-042: a skip must say why, and the customer can read it; a completion
 * may carry optional feedback, and is otherwise exactly as it was.
 */

beforeEach(async () => {
  await resetDb();
});

async function setupOrgQueue(queueOverrides: Record<string, unknown> = {}) {
  const ctx = await registerOwner();
  const queue = await createQueue(ctx.accessToken, queueOverrides);
  const service = await createService(ctx.accessToken, queue.id);
  const counter = await createCounter(ctx.accessToken, queue.id);
  await setCounterStatus(ctx.accessToken, counter.id, 'ACTIVE');
  return { ...ctx, queue, service, counter };
}
type Org = Awaited<ReturnType<typeof setupOrgQueue>>;

function skip(accessToken: string, tokenId: string, body?: Record<string, unknown>) {
  const req = api()
    .post(`/api/tokens/${tokenId}/skip`)
    .set('Authorization', `Bearer ${accessToken}`);
  return body === undefined ? req : req.send(body);
}

function complete(accessToken: string, tokenId: string, body?: Record<string, unknown>) {
  const req = api()
    .post(`/api/tokens/${tokenId}/complete`)
    .set('Authorization', `Bearer ${accessToken}`);
  return body === undefined ? req : req.send(body);
}

function call(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

function stored(tokenId: string) {
  return prisma.token.findUniqueOrThrow({
    where: { id: tokenId },
    select: { status: true, skipReasonCode: true, skipReasonText: true, completionFeedback: true },
  });
}

async function inProgress(org: Org) {
  const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
  expect((await call(servingToken(org.accessToken), token.id, org.counter.id)).status).toBe(200);
  expect((await startToken(servingToken(org.accessToken), token.id, token.deviceIdentifier)).status).toBe(200);
  return token;
}

describe('ADR-042 — skip requires a reason', () => {
  it('rejects a skip with no reason, and leaves the token untouched', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    for (const body of [undefined, {}, { reasonCode: '' }, { reasonCode: '   ' }]) {
      const res = await skip(servingToken(org.accessToken), token.id, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SKIP_REASON_REQUIRED');
    }
    expect(await stored(token.id)).toMatchObject({ status: 'WAITING', skipReasonCode: null });
  });

  it('rejects an unknown reason code', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const res = await skip(servingToken(org.accessToken), token.id, { reasonCode: 'BECAUSE' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_SKIP_REASON');
    expect((await stored(token.id)).status).toBe('WAITING');
  });

  it('a predefined reason succeeds and stores its code and the label the customer will read', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const res = await skip(servingToken(org.accessToken), token.id, { reasonCode: 'NO_RESPONSE' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SKIPPED');
    expect(await stored(token.id)).toEqual({
      status: 'SKIPPED',
      skipReasonCode: 'NO_RESPONSE',
      skipReasonText: 'No response from person',
      completionFeedback: null,
    });
  });

  it('a predefined reason ignores any text sent with it', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await skip(servingToken(org.accessToken), token.id, {
      reasonCode: 'CUSTOMER_LEFT',
      reasonText: 'internal note',
    });
    expect((await stored(token.id)).skipReasonText).toBe('Person requested to leave');
  });

  it('OTHER without real text is rejected', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    for (const body of [{ reasonCode: 'OTHER' }, { reasonCode: 'OTHER', reasonText: '  \n\t ' }]) {
      const res = await skip(servingToken(org.accessToken), token.id, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SKIP_REASON_TEXT_REQUIRED');
    }
    expect((await stored(token.id)).status).toBe('WAITING');
  });

  it('OTHER with text succeeds, stored trimmed and cleaned', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const res = await skip(servingToken(org.accessToken), token.id, {
      reasonCode: 'OTHER',
      reasonText: '  Wrong   queue —\nplease use Billing\u0007  ',
    });
    expect(res.status).toBe(200);
    expect(await stored(token.id)).toMatchObject({
      skipReasonCode: 'OTHER',
      skipReasonText: 'Wrong queue — please use Billing',
    });
  });

  it('OTHER text over the limit is rejected with its own code', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const res = await skip(servingToken(org.accessToken), token.id, {
      reasonCode: 'OTHER',
      reasonText: 'x'.repeat(201),
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SKIP_REASON_TEXT_TOO_LONG');
    expect(
      (await skip(servingToken(org.accessToken), token.id, { reasonCode: 'OTHER', reasonText: 'x'.repeat(200) }))
        .status,
    ).toBe(200);
  });

  it('applies to skipping a CALLED and an IN_PROGRESS customer too', async () => {
    const org = await setupOrgQueue();
    const called = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await call(servingToken(org.accessToken), called.id, org.counter.id);
    expect((await skip(servingToken(org.accessToken), called.id)).body.error.code).toBe('SKIP_REASON_REQUIRED');
    expect(
      (await skip(servingToken(org.accessToken), called.id, { reasonCode: 'CUSTOMER_NOT_PRESENT' })).status,
    ).toBe(200);

    const serving = await inProgress(org);
    expect((await skip(servingToken(org.accessToken), serving.id)).body.error.code).toBe('SKIP_REASON_REQUIRED');
    expect(
      (await skip(servingToken(org.accessToken), serving.id, { reasonCode: 'MISSING_REQUIREMENT' })).status,
    ).toBe(200);
  });

  it('the customer can read the reason; staff responses carry it too', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await skip(servingToken(org.accessToken), token.id, {
      reasonCode: 'OTHER',
      reasonText: 'Please visit the front desk',
    });

    const customer = await api().get(`/api/tokens/${token.id}`);
    expect(customer.body.data.skipReason).toEqual({
      code: 'OTHER',
      text: 'Please visit the front desk',
    });
    expect(customer.body.data.completionFeedback).toBeNull();

    const history = await api()
      .get('/api/service-history')
      .query({ status: 'SKIPPED' })
      .set('Authorization', `Bearer ${org.accessToken}`);
    expect(history.body.data[0].skipReason).toEqual({
      code: 'OTHER',
      text: 'Please visit the front desk',
    });
  });

  it('a skipped token stays terminal: it cannot be called, started, completed or skipped again', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await skip(servingToken(org.accessToken), token.id, { reasonCode: 'CUSTOMER_NOT_PRESENT' });

    expect((await call(servingToken(org.accessToken), token.id, org.counter.id)).body.error.code).toBe(
      'INVALID_TOKEN_TRANSITION',
    );
    expect((await complete(servingToken(org.accessToken), token.id)).body.error.code).toBe(
      'INVALID_TOKEN_TRANSITION',
    );
    const again = await skip(servingToken(org.accessToken), token.id, {
      reasonCode: 'OTHER',
      reasonText: 'overwrite?',
    });
    expect(again.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
    // The original reason is still what is recorded.
    expect(await stored(token.id)).toMatchObject({
      skipReasonCode: 'CUSTOMER_NOT_PRESENT',
      skipReasonText: 'Person not present',
    });
  });

  it('a skipped customer may rejoin the same queue', async () => {
    const org = await setupOrgQueue();
    const deviceIdentifier = 'device-skip-rejoin';
    const first = await createToken({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier,
    });
    await skip(servingToken(org.accessToken), first.id, { reasonCode: 'CUSTOMER_NOT_PRESENT' });

    const second = await createToken({
      queueId: org.queue.id,
      serviceId: org.service.id,
      deviceIdentifier,
    });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('WAITING');
  });

  it('keeps FCFS: a later customer still cannot be skipped ahead of an earlier one', async () => {
    const org = await setupOrgQueue();
    await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const later = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const res = await skip(servingToken(org.accessToken), later.id, { reasonCode: 'CUSTOMER_NOT_PRESENT' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FCFS_VIOLATION');
    expect((await stored(later.id)).skipReasonCode).toBeNull();
  });

  it('keeps permissions and tenant isolation', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const unauthenticated = await api()
      .post(`/api/tokens/${token.id}/skip`)
      .send({ reasonCode: 'NO_RESPONSE' });
    expect(unauthenticated.status).toBe(401);

    const other = await registerOwner();
    expect((await skip(await staffOf(other), token.id, { reasonCode: 'NO_RESPONSE' })).status).toBe(
      404,
    );

    // ADR-064: STAFF skip only in the queue their own counter serves — here an
    // Executive of this queue's Admin (ADR-069) with no counter yet.
    const staff = await createStaffWithRole(org.organizationId, 'STAFF', {
      workspaceAdminId: queueAdmins.get(org.queue.id)!.staffId,
    });
    const unassigned = await skip(staff.accessToken, token.id, { reasonCode: 'NO_RESPONSE' });
    expect(unassigned.status).toBe(403);
    expect(unassigned.body.error.code).toBe('OPERATOR_NOT_ASSIGNED_TO_COUNTER');
    await assignCounterTo(org.accessToken, org.counter.id, null);
    await assignCounterTo(org.accessToken, org.counter.id, staff.staffId);
    // Released by turning it off, re-staffed paused: open it again (ADR-069).
    await setCounterStatus(org.accessToken, org.counter.id, 'ACTIVE');
    expect((await skip(staff.accessToken, token.id, { reasonCode: 'NO_RESPONSE' })).status).toBe(
      200,
    );
  });
});

describe('ADR-042 — completion with optional feedback', () => {
  it('completes exactly as before with no body at all', async () => {
    const org = await setupOrgQueue();
    const token = await inProgress(org);
    const res = await complete(servingToken(org.accessToken), token.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(await stored(token.id)).toMatchObject({ status: 'COMPLETED', completionFeedback: null });
  });

  it('stores feedback when given, trimmed, keeping line breaks', async () => {
    const org = await setupOrgQueue();
    const token = await inProgress(org);
    const res = await complete(servingToken(org.accessToken), token.id, {
      feedback: '  Please bring the original document next time.\n\nThank you!  ',
    });
    expect(res.status).toBe(200);
    expect((await stored(token.id)).completionFeedback).toBe(
      'Please bring the original document next time.\n\nThank you!',
    );

    const customer = await api().get(`/api/tokens/${token.id}`);
    expect(customer.body.data.status).toBe('COMPLETED');
    expect(customer.body.data.completionFeedback).toBe(
      'Please bring the original document next time.\n\nThank you!',
    );
    expect(customer.body.data.skipReason).toBeNull();
  });

  it('treats blank feedback as an ordinary completion', async () => {
    const org = await setupOrgQueue();
    const token = await inProgress(org);
    expect((await complete(servingToken(org.accessToken), token.id, { feedback: '   \n  ' })).status).toBe(200);
    expect(await stored(token.id)).toMatchObject({ status: 'COMPLETED', completionFeedback: null });
  });

  it('enforces the feedback length limit and leaves the token IN_PROGRESS', async () => {
    const org = await setupOrgQueue();
    const token = await inProgress(org);
    const res = await complete(servingToken(org.accessToken), token.id, { feedback: 'x'.repeat(501) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COMPLETION_FEEDBACK_TOO_LONG');
    expect((await stored(token.id)).status).toBe('IN_PROGRESS');
    expect((await complete(servingToken(org.accessToken), token.id, { feedback: 'x'.repeat(500) })).status).toBe(
      200,
    );
  });

  it('feedback does not open any new path: a CALLED token still cannot be completed', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await call(servingToken(org.accessToken), token.id, org.counter.id);
    const res = await complete(servingToken(org.accessToken), token.id, { feedback: 'done' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
  });

  it('keeps the service-start verification rule: on a code queue, complete is only reachable after a verified start', async () => {
    const org = await setupOrgQueue({ requireServiceStartOtp: true });
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await call(servingToken(org.accessToken), token.id, org.counter.id);
    const directStart = await api()
      .post(`/api/tokens/${token.id}/start`)
      .set('Authorization', `Bearer ${servingToken(org.accessToken)}`)
      .send({});
    expect(directStart.body.error.code).toBe('SERVICE_START_VERIFICATION_REQUIRED');
    expect((await complete(servingToken(org.accessToken), token.id, { feedback: 'x' })).status).toBe(422);

    await startToken(servingToken(org.accessToken), token.id, token.deviceIdentifier);
    expect((await complete(servingToken(org.accessToken), token.id, { feedback: 'x' })).status).toBe(200);
  });

  it('keeps permissions and tenant isolation', async () => {
    const org = await setupOrgQueue();
    const token = await inProgress(org);
    expect((await api().post(`/api/tokens/${token.id}/complete`).send({})).status).toBe(401);
    const other = await registerOwner();
    expect((await complete(await staffOf(other), token.id, { feedback: 'x' })).status).toBe(404);
    expect((await stored(token.id)).status).toBe('IN_PROGRESS');
  });
});

describe('ADR-042 — operator text normalization', () => {
  it('strips control characters, collapses spaces, and only keeps line breaks where allowed', () => {
    expect(normalizeOperatorText('\u0000 a \u001b  b\t', { multiline: false })).toBe('a b');
    expect(normalizeOperatorText('line one\r\nline two', { multiline: false })).toBe(
      'line one line two',
    );
    expect(normalizeOperatorText('line one\r\n\n\n\nline two', { multiline: true })).toBe(
      'line one\n\nline two',
    );
    expect(normalizeOperatorText(' \n\t ', { multiline: true })).toBeNull();
  });
});

// Neutral wording: the labels say "person", not "customer". The codes are
// stable identifiers and did not change, and a token skipped under the old
// wording keeps the text it was given (it is a stored snapshot).
describe('skip reason wording — neutral "person" labels', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('every predefined code keeps its identifier and stores the neutral label', async () => {
    const org = await setupOrgQueue();
    const expected = {
      CUSTOMER_NOT_PRESENT: 'Person not present',
      NO_RESPONSE: 'No response from person',
      MISSING_REQUIREMENT: 'Required document/information missing',
      CUSTOMER_LEFT: 'Person requested to leave',
    } as const;
    for (const [code, text] of Object.entries(expected)) {
      const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
      expect((await skip(servingToken(org.accessToken), token.id, { reasonCode: code })).status).toBe(200);
      expect(await stored(token.id)).toMatchObject({ skipReasonCode: code, skipReasonText: text });
      const view = await api().get(`/api/tokens/${token.id}`);
      expect(view.body.data.skipReason).toEqual({ code, text });
      expect(text.toLowerCase()).not.toContain('customer');
    }
  });

  it('a token skipped before the wording change keeps its original text', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await skip(servingToken(org.accessToken), token.id, { reasonCode: 'CUSTOMER_NOT_PRESENT' });
    // Stand-in for a row written by the previous release.
    await prisma.token.update({
      where: { id: token.id },
      data: { skipReasonText: 'Customer not present' },
    });

    const view = await api().get(`/api/tokens/${token.id}`);
    expect(view.body.data.skipReason).toEqual({
      code: 'CUSTOMER_NOT_PRESENT',
      text: 'Customer not present',
    });
  });
});

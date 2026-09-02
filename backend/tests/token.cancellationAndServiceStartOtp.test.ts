import { beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  cancelTokenRequest,
  createCounter,
  createQueue,
  createService,
  createToken,
  registerOwner,
  setCounterStatus,
  startToken,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';

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

function callToken(accessToken: string, tokenId: string, counterId: string) {
  return api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ counterId });
}

function getVerificationCode(tokenId: string, deviceIdentifier: string) {
  return api().get(`/api/tokens/${tokenId}/verification-code`).query({ deviceIdentifier });
}

function reissueVerificationCode(tokenId: string, deviceIdentifier: string) {
  return api().post(`/api/tokens/${tokenId}/verification-code/reissue`).send({ deviceIdentifier });
}

function submitStart(accessToken: string, tokenId: string, verificationCode: string) {
  return api()
    .post(`/api/tokens/${tokenId}/start`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ verificationCode });
}

describe('V2 Checkpoint 7 — customer cancellation', () => {
  it('Test 1/2: a WAITING or CALLED token may be cancelled by its own device', async () => {
    const org = await setupOrgQueue();
    const waiting = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const waitingRes = await cancelTokenRequest(waiting.id, waiting.deviceIdentifier);
    expect(waitingRes.status).toBe(200);
    expect(waitingRes.body.data.status).toBe('CANCELLED');
    expect(waitingRes.body.data.cancelledAt).not.toBeNull();

    const called = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, called.id, org.counter.id);
    const calledRes = await cancelTokenRequest(called.id, called.deviceIdentifier);
    expect(calledRes.status).toBe(200);
    expect(calledRes.body.data.status).toBe('CANCELLED');
  });

  it('Test 3: an IN_PROGRESS token cannot be cancelled', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, token.id, org.counter.id);
    await startToken(org.accessToken, token.id, token.deviceIdentifier);

    const res = await cancelTokenRequest(token.id, token.deviceIdentifier);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TOKEN_TRANSITION');

    const row = await prisma.token.findUniqueOrThrow({ where: { id: token.id } });
    expect(row.status).toBe('IN_PROGRESS');
  });

  it('Test 4: device A cannot cancel device B\'s token', async () => {
    const org = await setupOrgQueue();
    const tokenB = await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier: 'device-b' });
    // Device A must itself be a real, already-registered device — createToken
    // registers it via its own token, matching the real-world shape of this
    // check (a device that has never interacted with this backend at all
    // hits DEVICE_NOT_FOUND instead, a different and less interesting case).
    const tokenA = await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier: 'device-a' });

    const res = await cancelTokenRequest(tokenB.id, tokenA.deviceIdentifier);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TOKEN_NOT_FOUND');

    const row = await prisma.token.findUniqueOrThrow({ where: { id: tokenB.id } });
    expect(row.status).toBe('WAITING');
  });

  it('Test 5/6: CANCELLED frees the active-token slot and does NOT consume the allowRepeatVisits allowance', async () => {
    const org = await setupOrgQueue({ allowRepeatVisits: false });
    const deviceIdentifier = 'device-cancel-rejoin';
    const first = await createToken({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier });
    const cancelRes = await cancelTokenRequest(first.id, deviceIdentifier);
    expect(cancelRes.status).toBe(200);

    // Same device, same queue, allowRepeatVisits=false — a COMPLETED token
    // would be blocked here (Checkpoint 6), but CANCELLED must not be.
    const second = await api()
      .post('/api/tokens')
      .set('Idempotency-Key', `idem-${Math.random().toString(36).slice(2, 10)}`)
      .send({ queueId: org.queue.id, serviceId: org.service.id, deviceIdentifier, formData: {} });
    expect(second.status).toBe(201);
  });

  it('Test 7: a CANCELLED token cannot be recalled', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await cancelTokenRequest(token.id, token.deviceIdentifier);

    const res = await api()
      .post(`/api/tokens/${token.id}/recall`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ counterId: org.counter.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
  });

  it('Test 20: FCFS advances correctly once an earlier WAITING token is cancelled', async () => {
    const org = await setupOrgQueue();
    const a001 = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const a002 = await createToken({ queueId: org.queue.id, serviceId: org.service.id });

    const tooEarly = await callToken(org.accessToken, a002.id, org.counter.id);
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('FCFS_VIOLATION');

    const cancelRes = await cancelTokenRequest(a001.id, a001.deviceIdentifier);
    expect(cancelRes.status).toBe(200);

    const nowEligible = await callToken(org.accessToken, a002.id, org.counter.id);
    expect(nowEligible.status).toBe(200);
    expect(nowEligible.body.data.status).toBe('CALLED');
  });
});

describe('V2 Checkpoint 7 — service-start verification code', () => {
  it('Test 8/9: a CALLED token gets a securely-derived code the owning device can read, and the raw code is never stored', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const callRes = await callToken(org.accessToken, token.id, org.counter.id);
    expect(callRes.status).toBe(200);

    const codeRes = await getVerificationCode(token.id, token.deviceIdentifier);
    expect(codeRes.status).toBe(200);
    expect(codeRes.body.data.code).toMatch(/^\d{6}$/);
    expect(codeRes.body.data.expiresAt).toBeDefined();

    // A different device can never read this token's code.
    const wrongDeviceRes = await getVerificationCode(token.id, 'someone-elses-device');
    expect(wrongDeviceRes.status).toBe(404);

    // Never stored in raw/recoverable form in Postgres.
    const row = await prisma.token.findUniqueOrThrow({ where: { id: token.id } });
    expect(row.serviceStartOtpCipher).not.toBeNull();
    expect(row.serviceStartOtpCipher).not.toBe(codeRes.body.data.code);
    expect(row.serviceStartOtpCipher).not.toContain(codeRes.body.data.code);
  });

  it('Test 15: the code never appears in the staff-facing call/start response or the customer view', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    const callRes = await callToken(org.accessToken, token.id, org.counter.id);

    const staffKeys = Object.keys(callRes.body.data).join(',');
    expect(staffKeys).not.toMatch(/otp/i);

    const codeRes = await getVerificationCode(token.id, token.deviceIdentifier);
    const startRes = await submitStart(org.accessToken, token.id, codeRes.body.data.code);
    const startKeys = Object.keys(startRes.body.data).join(',');
    expect(startKeys).not.toMatch(/otp/i);

    const customerRes = await api().get(`/api/tokens/${token.id}`);
    const customerKeys = Object.keys(customerRes.body.data).join(',');
    expect(customerKeys).not.toMatch(/otp/i);
  });

  it('Test 10/11: staff cannot start a CALLED token with a missing or wrong code, and the token stays CALLED', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, token.id, org.counter.id);

    const missing = await api()
      .post(`/api/tokens/${token.id}/start`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({});
    expect(missing.status).toBe(422);

    const wrong = await submitStart(org.accessToken, token.id, '000000');
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('INVALID_VERIFICATION_CODE');

    const row = await prisma.token.findUniqueOrThrow({ where: { id: token.id } });
    expect(row.status).toBe('CALLED');
  });

  it('Test 12/14: the correct code starts service exactly once — a replay fails', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, token.id, org.counter.id);
    const codeRes = await getVerificationCode(token.id, token.deviceIdentifier);

    const started = await submitStart(org.accessToken, token.id, codeRes.body.data.code);
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('IN_PROGRESS');

    const replay = await submitStart(org.accessToken, token.id, codeRes.body.data.code);
    expect(replay.status).toBe(422);
    expect(replay.body.error.code).toBe('INVALID_TOKEN_TRANSITION');
  });

  it('Test 13: an expired code is rejected', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, token.id, org.counter.id);
    const codeRes = await getVerificationCode(token.id, token.deviceIdentifier);

    await prisma.token.update({
      where: { id: token.id },
      data: { serviceStartOtpExpiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await submitStart(org.accessToken, token.id, codeRes.body.data.code);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('VERIFICATION_CODE_EXPIRED');

    const expiredCodeRes = await getVerificationCode(token.id, token.deviceIdentifier);
    expect(expiredCodeRes.status).toBe(410);
  });

  it('Test 16: five wrong attempts invalidate the current code, forcing a reissue', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, token.id, org.counter.id);
    const codeRes = await getVerificationCode(token.id, token.deviceIdentifier);

    for (let i = 0; i < 5; i++) {
      const res = await submitStart(org.accessToken, token.id, '000000');
      expect(res.status).toBe(422);
    }

    // The current (still-unexpired) code is now dead, even though it was
    // never actually entered wrong itself — the 5th wrong attempt already
    // cleared it, so this now reports "no code issued" rather than "wrong
    // code" or "locked" (both of which require a cipher to still be there).
    const lockedOut = await submitStart(org.accessToken, token.id, codeRes.body.data.code);
    expect(lockedOut.status).toBe(409);
    expect(lockedOut.body.error.code).toBe('VERIFICATION_CODE_REQUIRED');

    const row = await prisma.token.findUniqueOrThrow({ where: { id: token.id } });
    expect(row.serviceStartOtpCipher).toBeNull();
  });

  // V2 Checkpoint 7A: regression test for a lost-update race the security
  // re-inspection found and fixed — the failed-attempt counter used to be
  // read once, incremented in JS, then written back as a literal, so N
  // truly concurrent wrong guesses could collapse into far fewer than N
  // recorded attempts (every request reads the same stale count, so every
  // request writes the same "+1" value, clobbering each other). Fixed with
  // an atomic DB-side `increment`. This proves five concurrent wrong
  // guesses (fired via Promise.all, not sequentially like Test 16 above)
  // are counted accurately enough to reach lockout — a lossy counter would
  // leave the code still guessable after this many parallel attempts.
  it('Test 21 (Checkpoint 7A): concurrent wrong-code submissions cannot lose failed-attempt increments', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, token.id, org.counter.id);
    const codeRes = await getVerificationCode(token.id, token.deviceIdentifier);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => submitStart(org.accessToken, token.id, '000000')),
    );
    for (const res of attempts) {
      expect(res.status).toBe(422);
    }

    const row = await prisma.token.findUniqueOrThrow({ where: { id: token.id } });
    // A lossy read-modify-write could leave this well below 5 even though 5
    // genuinely wrong attempts were made; the atomic increment must not.
    expect(row.serviceStartOtpFailedAttempts).toBeGreaterThanOrEqual(5);
    expect(row.serviceStartOtpCipher).toBeNull();

    // The lockout must actually be in effect — even the real code no longer
    // works, matching Test 16's sequential-attempts assertion.
    const afterLockout = await submitStart(org.accessToken, token.id, codeRes.body.data.code);
    expect(afterLockout.status).toBe(409);
    expect(afterLockout.body.error.code).toBe('VERIFICATION_CODE_REQUIRED');
  });

  it('Test 17: reissuing mints a fresh code and invalidates the old one', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, token.id, org.counter.id);
    const firstCode = (await getVerificationCode(token.id, token.deviceIdentifier)).body.data.code;

    const reissueRes = await reissueVerificationCode(token.id, token.deviceIdentifier);
    expect(reissueRes.status).toBe(200);
    expect(reissueRes.body.data.code).toMatch(/^\d{6}$/);

    const oldCodeAttempt = await submitStart(org.accessToken, token.id, firstCode);
    expect(oldCodeAttempt.status).toBe(422);
    expect(oldCodeAttempt.body.error.code).toBe('INVALID_VERIFICATION_CODE');

    const newCodeAttempt = await submitStart(org.accessToken, token.id, reissueRes.body.data.code);
    expect(newCodeAttempt.status).toBe(200);
  });

  it('Test 18: Recall issues a brand new code, never reusing the pre-skip one', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, token.id, org.counter.id);
    const firstCode = (await getVerificationCode(token.id, token.deviceIdentifier)).body.data.code;

    await api().post(`/api/tokens/${token.id}/skip`).set('Authorization', `Bearer ${org.accessToken}`);
    await api()
      .post(`/api/tokens/${token.id}/recall`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ counterId: org.counter.id });

    const secondCode = (await getVerificationCode(token.id, token.deviceIdentifier)).body.data.code;
    // Not asserting the two codes differ (a random collision, while
    // vanishingly unlikely, isn't the actual property under test) — the
    // property that matters is that the PRE-skip code was invalidated and no
    // longer starts service.
    const oldCodeAttempt = await submitStart(org.accessToken, token.id, firstCode);
    expect(oldCodeAttempt.status).toBe(422);
    const newCodeAttempt = await submitStart(org.accessToken, token.id, secondCode);
    expect(newCodeAttempt.status).toBe(200);
  });

  it('Test 19: a concurrent cancel and a valid start on the same CALLED token produce exactly one winner', async () => {
    const org = await setupOrgQueue();
    const token = await createToken({ queueId: org.queue.id, serviceId: org.service.id });
    await callToken(org.accessToken, token.id, org.counter.id);
    const code = (await getVerificationCode(token.id, token.deviceIdentifier)).body.data.code;

    const [cancelRes, startRes] = await Promise.all([
      cancelTokenRequest(token.id, token.deviceIdentifier),
      submitStart(org.accessToken, token.id, code),
    ]);

    // Exactly one side wins (200); the other loses to a conflict — never
    // both, never neither. A numeric sort (default Array.sort is
    // lexicographic) always puts the one 2xx success first.
    const statuses = [cancelRes.status, startRes.status].sort((a, b) => a - b);
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    const row = await prisma.token.findUniqueOrThrow({ where: { id: token.id } });
    expect(['CANCELLED', 'IN_PROGRESS']).toContain(row.status);
    // The winning side's status must match the row — no split-brain result.
    if (cancelRes.status === 200) {
      expect(row.status).toBe('CANCELLED');
    } else {
      expect(row.status).toBe('IN_PROGRESS');
    }
  });
});

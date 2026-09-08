import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  createCounter,
  createQueue,
  createService,
  registerOwner,
  setCounterStatus,
  setFormFields,
  startToken,
} from './helpers/app';
import { resetDb } from './helpers/db';
import { prisma } from '../src/config/prisma';
import {
  setCustomerVerificationSenderForTesting,
  setEmailAvailableForTesting,
  type CustomerVerificationEmail,
} from '../src/services/email.service';
import { resolveRepeatPolicy } from '../src/services/queueIdentityPolicy.service';
import {
  computeEligibleAgainAt,
  normalizeCustomIdentity,
  normalizeEmail,
  normalizePhone,
} from '../src/utils/customerIdentity';

/**
 * The identity engine (ADR-034): a restricted queue recognises the person,
 * not the installation, so reinstalling the app must never hand someone a
 * second visit.
 */

/** An in-memory inbox, so the whole verification flow runs end to end
 * without a Resend account. Reads codes the way a real recipient would —
 * they never appear in a response or a log. */
class FakeMailbox {
  readonly sent: CustomerVerificationEmail[] = [];
  deliver = true;

  send = async (message: CustomerVerificationEmail): Promise<boolean> => {
    if (!this.deliver) return false;
    this.sent.push(message);
    return true;
  };

  lastCodeFor(email: string): string {
    const entry = [...this.sent].reverse().find((item) => item.to === email);
    if (!entry) throw new Error(`no code was sent to ${email}`);
    return entry.code;
  }
}

let mailbox: FakeMailbox;

beforeEach(async () => {
  await resetDb();
  mailbox = new FakeMailbox();
  setCustomerVerificationSenderForTesting(mailbox.send);
  setEmailAvailableForTesting(true);
});

afterEach(() => {
  setCustomerVerificationSenderForTesting(null);
  setEmailAvailableForTesting(null);
});

const NID_FIELD = { key: 'nid', label: 'NID Number', type: 'text', required: true } as const;

async function setupQueue(
  policy: Record<string, unknown> = {},
  fields: Record<string, unknown>[] = [NID_FIELD],
  /** Only the calendar-based windows need one; the rest work without. */
  timezone?: string,
) {
  const ctx = await registerOwner(timezone ? { timezone } : {});
  const queue = await createQueue(ctx.accessToken);
  const service = await createService(ctx.accessToken, queue.id);
  if (fields.length > 0) {
    await setFormFields(ctx.accessToken, queue.id, fields as never);
  }
  if (Object.keys(policy).length > 0) {
    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send(policy);
    if (res.status !== 200) {
      throw new Error(`policy update failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }
  return { ...ctx, queue, service };
}

const restrictByNid = (overrides: Record<string, unknown> = {}) => ({
  allowRepeatVisits: false,
  repeatRestrictionType: 'ONCE_EVER',
  repeatIdentityMode: 'CUSTOM_FIELD',
  repeatIdentityFieldKey: 'nid',
  ...overrides,
});

/** "Allow again after n units" — the everyday configuration. */
const restrictForDuration = (amount: number, unit: string) =>
  restrictByNid({
    repeatRestrictionType: 'DURATION',
    repeatRestrictionAmount: amount,
    repeatRestrictionUnit: unit,
  });

function join(
  queueId: string,
  serviceId: string,
  body: Record<string, unknown>,
  deviceIdentifier: string,
) {
  return api()
    .post('/api/tokens')
    .set('Idempotency-Key', `key-${Math.random().toString(36).slice(2)}`)
    .send({ queueId, serviceId, deviceIdentifier, ...body });
}

/** Drives a token all the way to COMPLETED, which is what consumes a visit. */
async function completeToken(
  org: Awaited<ReturnType<typeof setupQueue>>,
  tokenId: string,
  deviceIdentifier: string,
) {
  const counter = await createCounter(org.accessToken, org.queue.id);
  await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
  const called = await api()
    .post(`/api/tokens/${tokenId}/call`)
    .set('Authorization', `Bearer ${org.accessToken}`)
    .send({ counterId: counter.id });
  if (called.status !== 200) {
    throw new Error(`call failed: ${called.status} ${JSON.stringify(called.body)}`);
  }
  const started = await startToken(org.accessToken, tokenId, deviceIdentifier);
  if (started.status !== 200) {
    throw new Error(`start failed: ${started.status} ${JSON.stringify(started.body)}`);
  }
  const completed = await api()
    .post(`/api/tokens/${tokenId}/complete`)
    .set('Authorization', `Bearer ${org.accessToken}`);
  if (completed.status !== 200) {
    throw new Error(`complete failed: ${completed.status} ${JSON.stringify(completed.body)}`);
  }
}

describe('normalization', () => {
  it('treats formatting variants of one phone number as the same person', () => {
    const canonical = normalizePhone('+8801712345678');
    expect(normalizePhone('+880 1712-345678')).toBe(canonical);
    expect(normalizePhone(' +880 (17) 1234.5678 ')).toBe(canonical);
    expect(normalizePhone('008801712345678')).toBe(canonical);
  });

  it('refuses a number with no country, rather than guessing one', () => {
    expect(normalizePhone('01712345678')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('treats case and surrounding whitespace in an identifier as the same person', () => {
    expect(normalizeCustomIdentity('  ab-123456 ')).toBe(normalizeCustomIdentity('AB-123456'));
  });

  it('treats one mailbox written in different cases as one person', () => {
    const canonical = normalizeEmail('person@example.com');
    expect(normalizeEmail('Person@Example.com')).toBe(canonical);
    expect(normalizeEmail('  PERSON@EXAMPLE.COM  ')).toBe(canonical);
  });

  it('does not guess provider-specific mailbox tricks', () => {
    // Dots and +tags mean different things at different providers. Merging
    // them everywhere would deny service to genuinely different people at
    // any provider that treats them as significant.
    expect(normalizeEmail('first.last@example.com')).not.toBe(normalizeEmail('firstlast@example.com'));
    expect(normalizeEmail('person+queue@example.com')).not.toBe(normalizeEmail('person@example.com'));
  });

  it('rejects anything that is not an address', () => {
    for (const bad of ['', '   ', 'person', 'person@', '@example.com', 'person@example', 'a b@example.com']) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it('keeps meaningful characters, so two different identifiers stay different', () => {
    expect(normalizeCustomIdentity('AB-123')).not.toBe(normalizeCustomIdentity('AB123'));
    expect(normalizeCustomIdentity('12345')).not.toBe(normalizeCustomIdentity('12346'));
  });
});

describe('when a customer becomes eligible again', () => {
  const dhaka = 'Asia/Dhaka';
  const served = new Date('2026-09-08T10:00:00Z');

  it('never, for a once-ever queue — and it needs no timezone', () => {
    expect(computeEligibleAgainAt({ type: 'ONCE_EVER' }, served, null)).toBeNull();
  });

  it('counts minutes, hours, days and weeks as plain elapsed time', () => {
    const after = (amount: number, unit: 'MINUTE' | 'HOUR' | 'DAY' | 'WEEK') =>
      computeEligibleAgainAt({ type: 'DURATION', amount, unit }, served, null)!.toISOString();

    expect(after(90, 'MINUTE')).toBe('2026-09-08T11:30:00.000Z');
    expect(after(12, 'HOUR')).toBe('2026-09-08T22:00:00.000Z');
    expect(after(30, 'DAY')).toBe('2026-10-08T10:00:00.000Z');
    expect(after(2, 'WEEK')).toBe('2026-09-22T10:00:00.000Z');
  });

  it('advances a month by the calendar, not by thirty days', () => {
    const oneMonth = computeEligibleAgainAt(
      { type: 'DURATION', amount: 1, unit: 'MONTH' },
      served,
      dhaka,
    )!;
    // Served 8 September; back on 8 October, same time of day.
    expect(oneMonth.toISOString()).toBe('2026-10-08T10:00:00.000Z');
    // Thirty days would have been 8 October too here, so prove the difference
    // where the two genuinely diverge: February is short.
    const fromJanuary = computeEligibleAgainAt(
      { type: 'DURATION', amount: 1, unit: 'MONTH' },
      new Date('2026-01-31T10:00:00Z'),
      dhaka,
    )!;
    expect(fromJanuary.toISOString()).toBe('2026-02-28T10:00:00.000Z');
  });

  it('advances a year by the calendar', () => {
    const oneYear = computeEligibleAgainAt(
      { type: 'DURATION', amount: 1, unit: 'YEAR' },
      served,
      dhaka,
    )!;
    expect(oneYear.toISOString()).toBe('2027-09-08T10:00:00.000Z');
    // A leap day cannot roll into 1 March.
    const fromLeapDay = computeEligibleAgainAt(
      { type: 'DURATION', amount: 1, unit: 'YEAR' },
      new Date('2028-02-29T10:00:00Z'),
      dhaka,
    )!;
    expect(fromLeapDay.toISOString()).toBe('2029-02-28T10:00:00.000Z');
  });

  it('uses the queue timezone, so the wait is measured on the queue’s clock', () => {
    // Mid-October to mid-November: New York leaves daylight saving in
    // between and Dhaka does not, so keeping the same *local* time of day
    // lands the two zones on genuinely different instants. That divergence is
    // the whole reason a calendar window needs a zone at all.
    const served = new Date('2026-10-15T20:00:00Z');
    const inDhaka = computeEligibleAgainAt(
      { type: 'DURATION', amount: 1, unit: 'MONTH' },
      served,
      dhaka,
    )!;
    const inNewYork = computeEligibleAgainAt(
      { type: 'DURATION', amount: 1, unit: 'MONTH' },
      served,
      'America/New_York',
    )!;

    expect(inDhaka.toISOString()).toBe('2026-11-15T20:00:00.000Z');
    // Still 16:00 in New York, but that is now 21:00 UTC rather than 20:00.
    expect(inNewYork.toISOString()).toBe('2026-11-15T21:00:00.000Z');
  });

  it('returns the exact cutoff instant for a fixed end date', () => {
    const until = new Date('2026-12-31T17:59:00Z');
    expect(computeEligibleAgainAt({ type: 'UNTIL_DATETIME', until }, served, dhaka)).toEqual(until);
  });
});

describe('queue identity policy configuration', () => {
  it('rejects a restricted queue with no identity method', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ allowRepeatVisits: false });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDENTITY_POLICY_REQUIRED');
  });

  it('requires a timezone for a recurring period, and never invents one', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await setFormFields(ctx.accessToken, queue.id, [NID_FIELD] as never);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send(restrictForDuration(1, 'MONTH'));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUEUE_TIMEZONE_REQUIRED');
  });

  it('rejects an identity field that is optional or cannot identify anyone', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await setFormFields(ctx.accessToken, queue.id, [
      { key: 'nid', label: 'NID', type: 'text', required: false },
      { key: 'agree', label: 'Agree', type: 'checkbox', required: true },
    ] as never);

    const optional = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send(restrictByNid());
    expect(optional.status).toBe(422);
    expect(optional.body.error.code).toBe('IDENTITY_FIELD_MUST_BE_REQUIRED');

    const wrongType = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send(restrictByNid({ repeatIdentityFieldKey: 'agree' }));
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.error.code).toBe('IDENTITY_FIELD_TYPE_INVALID');
  });

  it.each(['VERIFIED_PHONE', 'VERIFIED_PHONE_AND_CUSTOM_FIELD'])(
    'refuses to configure %s, which is deferred (ADR-037)',
    async (mode) => {
      const ctx = await registerOwner();
      const queue = await createQueue(ctx.accessToken);
      await setFormFields(ctx.accessToken, queue.id, [NID_FIELD] as never);

      const res = await api()
        .put(`/api/queues/${queue.id}`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .send({
          allowRepeatVisits: false,
          repeatRestrictionType: 'ONCE_EVER',
          repeatIdentityMode: mode,
          repeatIdentityFieldKey: 'nid',
        });

      // Refused twice over: the request validator no longer lists the phone
      // modes at all, and the policy resolver refuses them again in case the
      // two ever drift apart. Either rejection is correct — what matters is
      // that no queue can be left configured this way.
      expect([409, 422]).toContain(res.status);
      const stored = await prisma.queue.findUniqueOrThrow({ where: { id: queue.id } });
      expect(stored.repeatIdentityMode).toBeNull();
      expect(stored.allowRepeatVisits).toBe(true);
    },
  );

  it('refuses a phone mode even if it reaches the policy resolver directly', async () => {
    // Belt and braces on the rule itself rather than the request shape: the
    // resolver is what a future caller would go through.
    await expect(
      resolveRepeatPolicy(
        null,
        null,
        { allowRepeatVisits: false, repeatRestrictionType: 'ONCE_EVER', repeatIdentityMode: 'VERIFIED_PHONE' },
        null,
      ),
    ).rejects.toMatchObject({ code: 'IDENTITY_MODE_UNAVAILABLE' });
  });

  it('refuses verified email when no email provider is configured', async () => {
    setEmailAvailableForTesting(false);
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        allowRepeatVisits: false,
        repeatRestrictionType: 'ONCE_EVER',
        repeatIdentityMode: 'VERIFIED_EMAIL',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_VERIFICATION_UNAVAILABLE');
  });

  it('will not let the identity question be deleted while it is in use', async () => {
    const org = await setupQueue(restrictByNid());

    const res = await api()
      .put(`/api/queues/${org.queue.id}/form-fields`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ fields: [{ key: 'name', label: 'Name', type: 'text', required: true }] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDENTITY_FIELD_IN_USE');
  });

  it('will not let the identity question become optional while it is in use', async () => {
    const org = await setupQueue(restrictByNid());

    const res = await api()
      .put(`/api/queues/${org.queue.id}/form-fields`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ fields: [{ ...NID_FIELD, required: false }] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDENTITY_FIELD_IN_USE');
  });

  it('keeps historical claims when a restriction is switched off', async () => {
    const org = await setupQueue(restrictByNid());
    const token = await join(org.queue.id, org.service.id, { formData: { nid: 'A1' } }, 'device-1');
    expect(token.status).toBe(201);

    const res = await api()
      .put(`/api/queues/${org.queue.id}`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ allowRepeatVisits: true });

    expect(res.status).toBe(200);
    // Nothing destructive: the record of who visited survives, so re-enabling
    // the restriction later does not start from a blank slate.
    expect(await prisma.queueIdentityClaim.count({ where: { queueId: org.queue.id } })).toBe(1);
  });
});

describe('repeat enforcement by customer identity', () => {
  it('does not require an identity when repeat visits are allowed', async () => {
    const org = await setupQueue({}, []);

    const first = await join(org.queue.id, org.service.id, { formData: {} }, 'device-1');
    expect(first.status).toBe(201);
    expect(await prisma.queueIdentityClaim.count()).toBe(0);
  });

  it('rejects a join with the identity answer missing', async () => {
    const org = await setupQueue(restrictByNid());

    const res = await join(org.queue.id, org.service.id, { formData: { nid: '   ' } }, 'device-1');

    // The form's own required-field validation catches a blank answer first;
    // either way the join cannot proceed without an identity.
    expect(res.status).toBe(422);
  });

  it('a reinstall does not reset the restriction', async () => {
    const org = await setupQueue(restrictByNid());
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-123' } }, 'device-1');
    expect(first.status).toBe(201);
    await completeToken(org, first.body.data.id, 'device-1');

    // A brand-new installation identifier — exactly what a reinstall produces.
    const second = await join(
      org.queue.id,
      org.service.id,
      { formData: { nid: 'A-123' } },
      'device-2-after-reinstall',
    );

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
    expect(second.body.error.details.reason).toBe('ALREADY_USED');
  });

  it('matches normalization variants of the same identifier', async () => {
    const org = await setupQueue(restrictByNid());
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'ab-123' } }, 'd1');
    await completeToken(org, first.body.data.id, 'd1');

    const second = await join(org.queue.id, org.service.id, { formData: { nid: '  AB-123 ' } }, 'd2');

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
  });

  it('lets a second customer use the same shared phone once the first is served', async () => {
    // A shared or family handset is one installation but two people. The
    // restriction is on the person, so the second one must be able to join.
    const org = await setupQueue(restrictByNid());
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'shared');
    await completeToken(org, first.body.data.id, 'shared');

    const second = await join(org.queue.id, org.service.id, { formData: { nid: 'B-2' } }, 'shared');

    expect(second.status).toBe(201);
  });

  it('still stops one installation holding two active tokens, whoever they claim to be', async () => {
    const org = await setupQueue(restrictByNid());
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'shared');
    expect(first.status).toBe(201);

    // Different person, same installation, first token still active: refused
    // by the installation-scoped rule, not by the identity rule.
    const second = await join(org.queue.id, org.service.id, { formData: { nid: 'B-2' } }, 'shared');

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DEVICE_ALREADY_IN_QUEUE');
  });

  it('keeps different customers separate', async () => {
    const org = await setupQueue(restrictByNid());
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await completeToken(org, first.body.data.id, 'd1');

    const second = await join(org.queue.id, org.service.id, { formData: { nid: 'B-2' } }, 'd2');

    expect(second.status).toBe(201);
  });

  it('stops the same person holding two active tokens from two installations', async () => {
    const org = await setupQueue(restrictByNid());
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'phone-a');
    expect(first.status).toBe(201);

    // Still only WAITING — the reservation, not consumption, is what blocks.
    const second = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'phone-b');

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
  });

  it('lets exactly one of two simultaneous joins through', async () => {
    const org = await setupQueue(restrictByNid());

    const results = await Promise.all([
      join(org.queue.id, org.service.id, { formData: { nid: 'RACE-1' } }, 'device-a'),
      join(org.queue.id, org.service.id, { formData: { nid: 'RACE-1' } }, 'device-b'),
    ]);

    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(results.filter((res) => res.status === 409)).toHaveLength(1);
    expect(await prisma.token.count({ where: { queueId: org.queue.id } })).toBe(1);
  });

  it('releases the hold when a visit is cancelled — nothing was delivered', async () => {
    const org = await setupQueue(restrictByNid());
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await api()
      .post(`/api/tokens/${first.body.data.id}/cancel`)
      .send({ deviceIdentifier: 'd1' });

    const second = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd2');

    expect(second.status).toBe(201);
  });

  it('releases the hold when a customer is skipped', async () => {
    const org = await setupQueue(restrictByNid());
    const counter = await createCounter(org.accessToken, org.queue.id);
    await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await api()
      .post(`/api/tokens/${first.body.data.id}/skip`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    const second = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd2');

    expect(second.status).toBe(201);
  });

  /**
   * A skipped customer who turns up is recalled onto the same token, so the
   * hold released at the skip has to be taken again — and the visit has to be
   * recorded when it is finally delivered. Before this was handled, an
   * ordinary "skip the no-show, recall them when they arrive" shift bypassed
   * the restriction entirely.
   */
  it('records the visit when a skipped customer is recalled and served', async () => {
    const org = await setupQueue(restrictByNid());
    const counter = await createCounter(org.accessToken, org.queue.id);
    await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await api()
      .post(`/api/tokens/${first.body.data.id}/skip`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    const recalled = await api()
      .post(`/api/tokens/${first.body.data.id}/recall`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ counterId: counter.id });
    expect(recalled.status).toBe(200);

    // Recalled and about to be served: the hold is back, so the same person
    // cannot also join from another installation.
    const whileRecalled = await join(
      org.queue.id,
      org.service.id,
      { formData: { nid: 'A-1' } },
      'd2',
    );
    expect(whileRecalled.status).toBe(409);
    expect(whileRecalled.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');

    await startToken(org.accessToken, first.body.data.id, 'd1');
    await api()
      .post(`/api/tokens/${first.body.data.id}/complete`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    const claim = await prisma.queueIdentityClaim.findFirstOrThrow({
      where: { queueId: org.queue.id },
    });
    expect(claim.status).toBe('CONSUMED');

    const afterVisit = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd3');
    expect(afterVisit.status).toBe(409);
    expect(afterVisit.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
  });

  it('refuses a recall once the skipped customer has rejoined elsewhere', async () => {
    const org = await setupQueue(restrictByNid());
    const counter = await createCounter(org.accessToken, org.queue.id);
    await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await api()
      .post(`/api/tokens/${first.body.data.id}/skip`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    // Being skipped freed them to rejoin, and they did — from another phone.
    const rejoined = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd2');
    expect(rejoined.status).toBe(201);

    const recalled = await api()
      .post(`/api/tokens/${first.body.data.id}/recall`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ counterId: counter.id });

    // The newer token holds the identity; recalling the stale one would serve
    // the same person twice.
    expect(recalled.status).toBe(409);
    expect(recalled.body.error.code).toBe('IDENTITY_ALREADY_CLAIMED');
    const stale = await prisma.token.findUniqueOrThrow({ where: { id: first.body.data.id } });
    expect(stale.status).toBe('SKIPPED');
  });

  it('still recalls freely on a queue that does not limit repeat visits', async () => {
    const org = await setupQueue({}, []);
    const counter = await createCounter(org.accessToken, org.queue.id);
    await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
    const first = await join(org.queue.id, org.service.id, { formData: {} }, 'd1');
    await api()
      .post(`/api/tokens/${first.body.data.id}/skip`)
      .set('Authorization', `Bearer ${org.accessToken}`);

    const recalled = await api()
      .post(`/api/tokens/${first.body.data.id}/recall`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ counterId: counter.id });

    expect(recalled.status).toBe(200);
    expect(await prisma.queueIdentityClaim.count()).toBe(0);
  });

  it('never returns the identity snapshot in a staff token response', async () => {
    const org = await setupQueue(restrictByNid());
    const counter = await createCounter(org.accessToken, org.queue.id);
    await setCounterStatus(org.accessToken, counter.id, 'ACTIVE');
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');

    const called = await api()
      .post(`/api/tokens/${first.body.data.id}/call`)
      .set('Authorization', `Bearer ${org.accessToken}`)
      .send({ counterId: counter.id });

    expect(called.status).toBe(200);
    expect(called.body.data).not.toHaveProperty('identityFingerprint');
    expect(called.body.data).not.toHaveProperty('identityPeriodKey');
    expect(called.body.data).not.toHaveProperty('identityMode');
  });

  it('spends the entitlement only once service is completed', async () => {
    const org = await setupQueue(restrictByNid());
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await completeToken(org, first.body.data.id, 'd1');

    const claim = await prisma.queueIdentityClaim.findFirstOrThrow({
      where: { queueId: org.queue.id },
    });
    expect(claim.status).toBe('CONSUMED');
  });

  it('tells a blocked customer when they may come back', async () => {
    const org = await setupQueue(restrictForDuration(1, 'MONTH'), [NID_FIELD], 'Asia/Dhaka');
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await completeToken(org, first.body.data.id, 'd1');

    const blocked = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd2');

    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.reason).toBe('ALREADY_USED');
    // Roughly a month away, and an exact instant the app can render.
    const endsAt = new Date(blocked.body.error.details.restrictionEndsAt as string);
    const daysAway = (endsAt.getTime() - Date.now()) / 86_400_000;
    expect(daysAway).toBeGreaterThan(27);
    expect(daysAway).toBeLessThan(32);
  });

  it('lets the same person back once the window has passed', async () => {
    const org = await setupQueue(restrictForDuration(1, 'HOUR'));
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await completeToken(org, first.body.data.id, 'd1');

    const tooSoon = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd2');
    expect(tooSoon.status).toBe(409);

    // Moving the recorded eligibility into the past is what "an hour later"
    // looks like to the enforcement, without the test waiting an hour.
    await prisma.queueIdentityClaim.updateMany({
      where: { queueId: org.queue.id },
      data: { eligibleAgainAt: new Date(Date.now() - 1000) },
    });

    const later = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd3');
    expect(later.status).toBe(201);
  });

  it('keeps the spent visit on record after the customer returns', async () => {
    const org = await setupQueue(restrictForDuration(1, 'HOUR'));
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await completeToken(org, first.body.data.id, 'd1');
    await prisma.queueIdentityClaim.updateMany({
      where: { queueId: org.queue.id },
      data: { eligibleAgainAt: new Date(Date.now() - 1000) },
    });

    const later = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd2');
    expect(later.status).toBe(201);

    // Two rows: the earlier visit kept as history, the new one governing.
    const claims = await prisma.queueIdentityClaim.findMany({ where: { queueId: org.queue.id } });
    expect(claims).toHaveLength(2);
    expect(claims.filter((claim) => claim.supersededAt === null)).toHaveLength(1);
    expect(claims.filter((claim) => claim.supersededAt !== null)).toHaveLength(1);
  });

  it('blocks until an exact cutoff when the queue sets one', async () => {
    const org = await setupQueue(
      restrictByNid({
        repeatRestrictionType: 'UNTIL_DATETIME',
        repeatRestrictionUntilLocal: '2099-12-31T23:59',
      }),
      [NID_FIELD],
      'Asia/Dhaka',
    );
    const first = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');
    await completeToken(org, first.body.data.id, 'd1');

    const blocked = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd2');

    expect(blocked.status).toBe(409);
    // 23:59 on the queue's clock in Dhaka is 17:59 UTC.
    expect(blocked.body.error.details.restrictionEndsAt).toBe('2099-12-31T17:59:00.000Z');
  });

  it('refuses a calendar window when no timezone has been set anywhere', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await setFormFields(ctx.accessToken, queue.id, [NID_FIELD] as never);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send(restrictForDuration(1, 'MONTH'));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUEUE_TIMEZONE_REQUIRED');
  });

  it('needs no timezone for a window measured in elapsed time', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    await setFormFields(ctx.accessToken, queue.id, [NID_FIELD] as never);

    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send(restrictForDuration(48, 'HOUR'));

    expect(res.status).toBe(200);
  });

  it('refuses joins on a queue restricted before an identity method existed', async () => {
    const org = await setupQueue({}, []);
    // Exactly the shape a pre-ADR-034 restricted queue has in the database.
    await prisma.queue.update({
      where: { id: org.queue.id },
      data: { allowRepeatVisits: false },
    });

    const res = await join(org.queue.id, org.service.id, { formData: {} }, 'device-1');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_IDENTITY_CONFIGURATION_REQUIRED');
  });

  it('keeps identities separate across organizations', async () => {
    const orgA = await setupQueue(restrictByNid());
    const orgB = await setupQueue(restrictByNid());
    const first = await join(orgA.queue.id, orgA.service.id, { formData: { nid: 'SHARED' } }, 'd1');
    await completeToken(orgA, first.body.data.id, 'd1');

    // The same national ID at a different organization is a different visit.
    const second = await join(orgB.queue.id, orgB.service.id, { formData: { nid: 'SHARED' } }, 'd2');

    expect(second.status).toBe(201);
  });

  it('never stores the raw identity answer in the claim row', async () => {
    const org = await setupQueue(restrictByNid());
    await join(org.queue.id, org.service.id, { formData: { nid: 'SECRET-NID-9999' } }, 'd1');

    const claim = await prisma.queueIdentityClaim.findFirstOrThrow({
      where: { queueId: org.queue.id },
    });
    expect(JSON.stringify(claim)).not.toContain('SECRET-NID-9999');
    expect(claim.identityFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('customer email verification', () => {
  const EMAIL = 'person@example.com';

  async function emailQueue(mode = 'VERIFIED_EMAIL', fields: Record<string, unknown>[] = []) {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    if (fields.length > 0) {
      await setFormFields(ctx.accessToken, queue.id, fields as never);
    }
    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        allowRepeatVisits: false,
        repeatRestrictionType: 'ONCE_EVER',
        repeatIdentityMode: mode,
        ...(mode === 'VERIFIED_EMAIL_AND_CUSTOM_FIELD' ? { repeatIdentityFieldKey: 'nid' } : {}),
      });
    if (res.status !== 200) {
      throw new Error(`policy update failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return { ...ctx, queue, service };
  }

  const start = (queueId: string, email = EMAIL) =>
    api().post('/api/public/email-verification/start').send({ queueId, email });

  const confirm = (verificationId: string, code: string, email = EMAIL) =>
    api().post('/api/public/email-verification/confirm').send({ verificationId, code, email });

  /** The whole flow, returning the proof a join can carry. */
  async function verify(queueId: string, email = EMAIL): Promise<string> {
    const started = await start(queueId, email);
    const confirmed = await confirm(started.body.data.verificationId, mailbox.lastCodeFor(email), email);
    return confirmed.body.data.verificationProof as string;
  }

  it('sends a code and never returns it', async () => {
    const org = await emailQueue();

    const res = await start(org.queue.id);

    expect(res.status).toBe(201);
    expect(res.body.data.verificationId).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain(mailbox.lastCodeFor(EMAIL));
  });

  it('addresses the code to the mailbox that was asked for', async () => {
    const org = await emailQueue();

    await start(org.queue.id, 'Person@Example.COM');

    // Normalized before sending, so one person cannot hold two identities by
    // changing the case they type.
    expect(mailbox.sent.at(-1)!.to).toBe(EMAIL);
    expect(mailbox.sent.at(-1)!.code).toMatch(/^\d{6}$/);
  });

  it('verifies the correct code and issues a usable proof', async () => {
    const org = await emailQueue();
    const started = await start(org.queue.id);

    const res = await confirm(started.body.data.verificationId, mailbox.lastCodeFor(EMAIL));

    expect(res.status).toBe(200);
    expect(res.body.data.verificationProof).toBeDefined();

    const joined = await join(
      org.queue.id,
      org.service.id,
      { formData: {}, emailVerificationProof: res.body.data.verificationProof },
      'device-1',
    );
    expect(joined.status).toBe(201);
  });

  it('counts a wrong code against the attempt budget', async () => {
    const org = await emailQueue();
    const started = await start(org.queue.id);

    const res = await confirm(started.body.data.verificationId, '000000');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VERIFICATION_CODE_INCORRECT');
    const stored = await prisma.customerEmailVerification.findUniqueOrThrow({
      where: { id: started.body.data.verificationId },
    });
    expect(stored.failedAttempts).toBe(1);
  });

  it('stops accepting codes once the attempt budget is spent', async () => {
    const org = await emailQueue();
    const started = await start(org.queue.id);
    await prisma.customerEmailVerification.update({
      where: { id: started.body.data.verificationId },
      data: { failedAttempts: 99 },
    });

    const res = await confirm(started.body.data.verificationId, mailbox.lastCodeFor(EMAIL));

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('VERIFICATION_ATTEMPTS_EXCEEDED');
  });

  it('rejects an expired challenge', async () => {
    const org = await emailQueue();
    const started = await start(org.queue.id);
    await prisma.customerEmailVerification.update({
      where: { id: started.body.data.verificationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await confirm(started.body.data.verificationId, mailbox.lastCodeFor(EMAIL));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VERIFICATION_INVALID_OR_EXPIRED');
  });

  it('enforces a resend cooldown', async () => {
    const org = await emailQueue();
    await start(org.queue.id);

    const again = await start(org.queue.id);

    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('VERIFICATION_RESEND_TOO_SOON');
    // And no second email went out.
    expect(mailbox.sent).toHaveLength(1);
  });

  it('a resend replaces the previous code', async () => {
    const org = await emailQueue();
    const started = await start(org.queue.id);
    const firstCode = mailbox.lastCodeFor(EMAIL);
    // Moving the send time back is what "a minute later" looks like here.
    await prisma.customerEmailVerification.update({
      where: { id: started.body.data.verificationId },
      data: { lastSentAt: new Date(Date.now() - 5 * 60_000) },
    });

    const resent = await start(org.queue.id);
    expect(resent.status).toBe(201);
    // Same challenge row, so the cooldown and budget cannot be reset by
    // simply asking again.
    expect(resent.body.data.verificationId).toBe(started.body.data.verificationId);

    const stale = await confirm(started.body.data.verificationId, firstCode);
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('VERIFICATION_CODE_INCORRECT');

    const fresh = await confirm(started.body.data.verificationId, mailbox.lastCodeFor(EMAIL));
    expect(fresh.status).toBe(200);
  });

  it('will not verify a different address than the code was sent to', async () => {
    const org = await emailQueue();
    const started = await start(org.queue.id);

    const res = await confirm(
      started.body.data.verificationId,
      mailbox.lastCodeFor(EMAIL),
      'someone.else@example.com',
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VERIFICATION_EMAIL_MISMATCH');
  });

  it('will not accept a proof issued for another queue', async () => {
    const orgA = await emailQueue();
    const orgB = await emailQueue();
    const proof = await verify(orgA.queue.id);

    const res = await join(
      orgB.queue.id,
      orgB.service.id,
      { formData: {}, emailVerificationProof: proof },
      'device-1',
    );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('EMAIL_VERIFICATION_INVALID');
  });

  it('rejects a tampered proof', async () => {
    const org = await emailQueue();

    const res = await join(
      org.queue.id,
      org.service.id,
      { formData: {}, emailVerificationProof: 'not.a-real-proof' },
      'device-1',
    );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('EMAIL_VERIFICATION_INVALID');
  });

  it('rejects an expired proof', async () => {
    const org = await emailQueue();
    const proof = await verify(org.queue.id);
    // A proof carries its own expiry, so time is what invalidates it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 60 * 60_000));
    try {
      const res = await join(
        org.queue.id,
        org.service.id,
        { formData: {}, emailVerificationProof: proof },
        'device-1',
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('EMAIL_VERIFICATION_INVALID');
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires a proof at all on an email-identified queue', async () => {
    const org = await emailQueue();

    const res = await join(org.queue.id, org.service.id, { formData: {} }, 'device-1');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  });

  it('refuses to send for a queue that does not ask for an email', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await start(queue.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_VERIFICATION_NOT_REQUIRED');
    expect(mailbox.sent).toHaveLength(0);
  });

  it('reports a provider failure rather than claiming a code was sent', async () => {
    const org = await emailQueue();
    mailbox.deliver = false;

    const res = await start(org.queue.id);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('VERIFICATION_SEND_FAILED');
    // No usable challenge is left behind for a message nobody received.
    expect(await prisma.customerEmailVerification.count()).toBe(0);
    // And nothing about the provider leaks to the customer.
    expect(JSON.stringify(res.body)).not.toContain('Resend');
  });

  it('recognises the same person across installations by verified email', async () => {
    const org = await emailQueue();
    const proof = await verify(org.queue.id);

    const first = await join(
      org.queue.id,
      org.service.id,
      { formData: {}, emailVerificationProof: proof },
      'phone-a',
    );
    expect(first.status).toBe(201);

    const second = await join(
      org.queue.id,
      org.service.id,
      { formData: {}, emailVerificationProof: proof },
      'phone-b-different-installation',
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
  });

  it('a reinstall re-verifying the same address still cannot bypass the limit', async () => {
    const org = await emailQueue();
    const first = await join(
      org.queue.id,
      org.service.id,
      { formData: {}, emailVerificationProof: await verify(org.queue.id) },
      'device-1',
    );
    expect(first.status).toBe(201);
    await completeToken({ ...org, queue: org.queue } as never, first.body.data.id, 'device-1');

    // A fresh install, a fresh verification of the very same mailbox.
    await prisma.customerEmailVerification.deleteMany({});
    const second = await join(
      org.queue.id,
      org.service.id,
      { formData: {}, emailVerificationProof: await verify(org.queue.id) },
      'device-2-after-reinstall',
    );

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
  });

  it('treats two different addresses as two different people', async () => {
    const org = await emailQueue();
    const first = await join(
      org.queue.id,
      org.service.id,
      { formData: {}, emailVerificationProof: await verify(org.queue.id) },
      'd1',
    );
    expect(first.status).toBe(201);

    const other = await join(
      org.queue.id,
      org.service.id,
      { formData: {}, emailVerificationProof: await verify(org.queue.id, 'someone.else@example.com') },
      'd2',
    );

    expect(other.status).toBe(201);
  });

  it('lets exactly one of two simultaneous joins through', async () => {
    const org = await emailQueue();
    const proof = await verify(org.queue.id);

    const results = await Promise.all([
      join(org.queue.id, org.service.id, { formData: {}, emailVerificationProof: proof }, 'device-a'),
      join(org.queue.id, org.service.id, { formData: {}, emailVerificationProof: proof }, 'device-b'),
    ]);

    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(results.filter((res) => res.status === 409)).toHaveLength(1);
    expect(await prisma.token.count({ where: { queueId: org.queue.id } })).toBe(1);
  });

  it('never writes the address into the verification row', async () => {
    const org = await emailQueue();
    const started = await start(org.queue.id);

    const row = await prisma.customerEmailVerification.findUniqueOrThrow({
      where: { id: started.body.data.verificationId },
    });

    expect(JSON.stringify(row)).not.toContain('person@example.com');
    expect(JSON.stringify(row)).not.toContain(mailbox.lastCodeFor(EMAIL));
    expect(row.emailFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never writes the address into the identity claim', async () => {
    const org = await emailQueue();
    await join(
      org.queue.id,
      org.service.id,
      { formData: {}, emailVerificationProof: await verify(org.queue.id) },
      'd1',
    );

    const claim = await prisma.queueIdentityClaim.findFirstOrThrow({
      where: { queueId: org.queue.id },
    });
    expect(JSON.stringify(claim)).not.toContain('person@example.com');
    expect(claim.identityFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('email combined with a custom identifier', () => {
  const EMAIL = 'family@example.com';

  async function compoundQueue() {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await setFormFields(ctx.accessToken, queue.id, [NID_FIELD] as never);
    const res = await api()
      .put(`/api/queues/${queue.id}`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({
        allowRepeatVisits: false,
        repeatRestrictionType: 'ONCE_EVER',
        repeatIdentityMode: 'VERIFIED_EMAIL_AND_CUSTOM_FIELD',
        repeatIdentityFieldKey: 'nid',
      });
    if (res.status !== 200) {
      throw new Error(`policy update failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return { ...ctx, queue, service };
  }

  async function verify(queueId: string, email = EMAIL): Promise<string> {
    const started = await api()
      .post('/api/public/email-verification/start')
      .send({ queueId, email });
    const confirmed = await api()
      .post('/api/public/email-verification/confirm')
      .send({
        verificationId: started.body.data.verificationId,
        code: mailbox.lastCodeFor(email),
        email,
      });
    return confirmed.body.data.verificationProof as string;
  }

  it('lets two people share one mailbox when their identifiers differ', async () => {
    const org = await compoundQueue();
    const proof = await verify(org.queue.id);

    const parent = await join(
      org.queue.id,
      org.service.id,
      { formData: { nid: 'A-1' }, emailVerificationProof: proof },
      'shared-phone',
    );
    expect(parent.status).toBe(201);
    await completeToken({ ...org } as never, parent.body.data.id, 'shared-phone');

    // Same household mailbox, a different person's national ID.
    const child = await join(
      org.queue.id,
      org.service.id,
      { formData: { nid: 'B-2' }, emailVerificationProof: proof },
      'shared-phone',
    );

    expect(child.status).toBe(201);
  });

  it('still blocks the same mailbox and the same identifier', async () => {
    const org = await compoundQueue();
    const proof = await verify(org.queue.id);
    const first = await join(
      org.queue.id,
      org.service.id,
      { formData: { nid: 'A-1' }, emailVerificationProof: proof },
      'd1',
    );
    await completeToken({ ...org } as never, first.body.data.id, 'd1');

    const again = await join(
      org.queue.id,
      org.service.id,
      { formData: { nid: 'A-1' }, emailVerificationProof: proof },
      'd2',
    );

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REPEAT_VISIT_NOT_ALLOWED');
  });

  it('requires both halves, not just the verified email', async () => {
    const org = await compoundQueue();
    const proof = await verify(org.queue.id);

    const res = await join(
      org.queue.id,
      org.service.id,
      { formData: { nid: '   ' }, emailVerificationProof: proof },
      'd1',
    );

    // The form's own required-field rule catches the blank answer first;
    // either way the join cannot proceed on the email alone.
    expect(res.status).toBe(422);
  });

  it('requires the verified email, not just the identifier', async () => {
    const org = await compoundQueue();

    const res = await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  });
});

describe('what the app is told before joining', () => {
  it('describes the identity requirement without revealing anyone', async () => {
    const org = await setupQueue(restrictForDuration(30, 'DAY'));
    await join(org.queue.id, org.service.id, { formData: { nid: 'A-1' } }, 'd1');

    const res = await api().get(`/api/public/queues/${org.queue.id}/config`);

    expect(res.status).toBe(200);
    expect(res.body.data.identity).toEqual({
      repeatRestricted: true,
      restrictionType: 'DURATION',
      restrictionAmount: 30,
      restrictionUnit: 'DAY',
      restrictionUntil: null,
      identityMode: 'CUSTOM_FIELD',
      identityFieldKey: 'nid',
      requiresVerifiedPhone: false,
      requiresVerifiedEmail: false,
      configurationRequired: false,
    });
    // Who has already visited is never public.
    expect(JSON.stringify(res.body)).not.toContain('A-1');
  });

  it('publishes the queue timezone so the app can show the queue’s own clock', async () => {
    const ctx = await registerOwner({ timezone: 'Asia/Dhaka' });
    const queue = await createQueue(ctx.accessToken);

    const res = await api().get(`/api/public/queues/${queue.id}/config`);

    expect(res.body.data.timezone).toBe('Asia/Dhaka');
  });

  it('says nothing is required when repeat visits are allowed', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);

    const res = await api().get(`/api/public/queues/${queue.id}/config`);

    expect(res.body.data.identity.repeatRestricted).toBe(false);
    expect(res.body.data.identity.requiresVerifiedPhone).toBe(false);
  });
});

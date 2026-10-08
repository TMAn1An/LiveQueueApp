import { beforeEach, describe, expect, it } from 'vitest';
import { api, createCounter, createQueue, createService, createToken, registerOwner, setFormFields, workspaceAdminFor } from './helpers/app';
import { resetDb } from './helpers/db';
import { isLatinName, isLatinText } from '../src/validators/latinText';

/**
 * ADR-056: human-entered names and descriptions are English/Latin script
 * only, enforced by the API itself so no client can bypass it.
 */

const NON_LATIN = [
  'ঢাকা ক্লিনিক', // Bengali
  'عيادة', // Arabic
  '诊所', // Chinese
  'Клиника', // Cyrillic
  'क्लिनिक', // Devanagari
  'Clinic 😀', // emoji
  'Café', // accented Latin is outside A-Z too
];

describe('ADR-056 — the patterns', () => {
  it('names accept letters, digits, spaces and the allowed punctuation', () => {
    for (const ok of [
      'Main Hall',
      'Dr. Rahman (Room 2)',
      "O'Brien & Sons, Ltd.",
      'Counter A-1_b',
      'Lab: X-Ray / Scan + Report',
      '',
    ]) {
      expect(isLatinName(ok)).toBe(true);
    }
  });

  it('names reject every non-Latin script, emoji, and punctuation outside the list', () => {
    for (const bad of [...NON_LATIN, 'Who?', 'Clinic!', 'a@b', 'Tab\there', 'Line\nbreak']) {
      expect(isLatinName(bad)).toBe(false);
    }
  });

  it('text additionally accepts any printable ASCII and line breaks, but no other script', () => {
    expect(isLatinText('What is your age? (years)\nSecond line! 100% "quoted" #1 @home;')).toBe(true);
    for (const bad of NON_LATIN) {
      expect(isLatinText(bad)).toBe(false);
    }
  });
});

describe('ADR-056 — enforced by every write that takes a restricted field', () => {
  beforeEach(async () => {
    await resetDb();
  });

  const BENGALI = 'ঢাকা';

  function expectRejected(res: { status: number; body: { error: { code: string } } }) {
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  }

  it('organization name — registration, rename and availability', async () => {
    expectRejected(
      await api()
        .post('/api/auth/register')
        .send({ organizationName: BENGALI, email: 'o@example.com', password: 'Password123' }),
    );
    const ctx = await registerOwner();
    expectRejected(
      await api()
        .put('/api/organizations/me')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .send({ name: BENGALI }),
    );
    expectRejected(
      await api().get('/api/auth/organization-name-availability').query({ name: BENGALI }),
    );
  });

  it('queue name, description and customer terminology — on create and update', async () => {
    const ctx = await registerOwner();
    const auth = { Authorization: `Bearer ${ctx.accessToken}` };
    for (const body of [
      { name: BENGALI, tokenPrefix: 'A' },
      { name: 'Ok', tokenPrefix: 'A', description: BENGALI },
      { name: 'Ok', tokenPrefix: 'A', clientTerminology: BENGALI },
    ]) {
      expectRejected(await api().post('/api/queues').set(auth).send(body));
    }
    const queue = await createQueue(ctx.accessToken);
    for (const body of [{ name: BENGALI }, { description: BENGALI }, { clientTerminology: BENGALI }]) {
      expectRejected(await api().put(`/api/queues/${queue.id}`).set(auth).send(body));
    }
  });

  it('service name and description — on create and update', async () => {
    const ctx = await registerOwner();
    const auth = { Authorization: `Bearer ${ctx.accessToken}` };
    const queue = await createQueue(ctx.accessToken);
    expectRejected(
      await api()
        .post(`/api/queues/${queue.id}/services`)
        .set(auth)
        .send({ serviceName: BENGALI, durationMinutes: 5 }),
    );
    expectRejected(
      await api()
        .post(`/api/queues/${queue.id}/services`)
        .set(auth)
        .send({ serviceName: 'Ok', description: BENGALI, durationMinutes: 5 }),
    );
    const service = await createService(ctx.accessToken, queue.id);
    expectRejected(
      await api().put(`/api/services/${service.id}`).set(auth).send({ serviceName: BENGALI }),
    );
  });

  it('counter name — on create and update', async () => {
    const ctx = await registerOwner();
    const auth = { Authorization: `Bearer ${ctx.accessToken}` };
    const queue = await createQueue(ctx.accessToken);
    expectRejected(
      await api().post(`/api/queues/${queue.id}/counters`).set(auth).send({ name: BENGALI }),
    );
    const counter = await createCounter(ctx.accessToken, queue.id);
    expectRejected(await api().put(`/api/counters/${counter.id}`).set(auth).send({ name: BENGALI }));
  });

  it('staff name — on invite and update', async () => {
    const ctx = await registerOwner();
    const auth = { Authorization: `Bearer ${ctx.accessToken}` };
    expectRejected(
      await api()
        .post('/api/staff')
        .set(auth)
        .send({ name: BENGALI, email: 'new@example.com', role: 'STAFF' }),
    );
    expectRejected(await api().put(`/api/staff/${ctx.staffId}`).set(auth).send({ name: BENGALI }));
  });

  it('form field label, placeholder and options', async () => {
    const ctx = await registerOwner();
    const auth = { Authorization: `Bearer ${ctx.accessToken}` };
    const queue = await createQueue(ctx.accessToken);
    const base = { key: 'f1', label: 'Your age?', type: 'text' };
    for (const field of [
      { ...base, label: BENGALI },
      { ...base, placeholder: BENGALI },
      { ...base, type: 'dropdown', options: ['One', BENGALI] },
    ]) {
      expectRejected(
        await api().put(`/api/queues/${queue.id}/form-fields`).set(auth).send({ fields: [field] }),
      );
    }
  });

  it('accepts valid Latin punctuation everywhere and saves it unchanged', async () => {
    const ctx = await registerOwner({ organizationName: "O'Brien & Sons (Dhaka), Ltd." });
    const queue = await createQueue(ctx.accessToken, {
      name: 'Lab: X-Ray / Scan + Report',
      description: 'Bring your ID.\nQuestions? Ask at desk #2!',
      clientTerminology: 'patient',
    });
    expect(queue.name).toBe('Lab: X-Ray / Scan + Report');
    expect(queue.description).toBe('Bring your ID.\nQuestions? Ask at desk #2!');
    // setFormFields throws unless the API answers 200.
    const saved = await setFormFields(ctx.accessToken, queue.id, [
      { key: 'age', label: 'What is your age? (years)', type: 'dropdown', options: ['18-30', '31+'] },
    ]);
    expect(saved.fields).toHaveLength(1);
  });

  it('never applies to what a customer types into the queue form', async () => {
    const ctx = await registerOwner();
    const queue = await createQueue(ctx.accessToken);
    const service = await createService(ctx.accessToken, queue.id);
    await setFormFields(ctx.accessToken, queue.id, [
      { key: 'name', label: 'Your name', type: 'text', required: true },
    ]);
    const token = await createToken({
      queueId: queue.id,
      serviceId: service.id,
      formData: { name: 'রহিম' },
    });
    expect(token.id).toBeTruthy();
  });

  it('never applies to email addresses', async () => {
    const ctx = await registerOwner();
    const res = await api()
      .post('/api/staff')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ name: 'New Person', email: 'new.person+desk@example.com', role: 'STAFF', workspaceAdminId: await workspaceAdminFor(ctx.accessToken) });
    expect(res.status).toBe(201);
  });
});

// Production end-to-end QA (ADR-069/070) — one disposable organization,
// created and removed through the application's own API. Passwords and
// tokens are generated here, masked, and never printed or stored.
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const { API, WEB, QA_EMAIL } = process.env;
const ORG_NAME = `LiveQueue Production QA ${new Date().toISOString().slice(0, 10)}`;
const [local, domain] = QA_EMAIL.split('@');
const mail = (tag) => `${local}-${tag}@${domain}`;
const RUN = `qa-e2e-${Date.now().toString(36)}`;
const devices = new Set();
const dev = () => { const d = `${RUN}-${randomUUID()}`; devices.add(d); return d; };
const pw = () => { const p = `Qa9${randomBytes(12).toString('hex')}x`; console.log(`::add-mask::${p}`); return p; };

const results = [];
let failed = false;
const rec = (ok, raw) => { const msg = String(raw).replace(/\s*\n\s*/g, ' / '); results.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };
const info = (msg) => { results.push(`INFO ${msg}`); console.log(`INFO ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, token, body, headers = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${API}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
      if (r.status >= 500) rec(false, `server error ${r.status} on ${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}: ${text.slice(0, 160)}`);
      return { status: r.status, body: json, data: json?.data, code: json?.error?.code };
    } catch (e) { if (attempt === 2) return { status: 0, body: null, data: null, code: String(e) }; await sleep(2000); }
  }
}
const login = async (email, password) => {
  const r = await call('POST', '/api/auth/login', null, { email, password });
  if (r.data?.accessToken) console.log(`::add-mask::${r.data.accessToken}`);
  return r.data?.accessToken;
};
const check = (label, r, status, code) => rec(r.status === status && (!code || r.code === code), `${label} -> ${r.status}${r.code ? ' ' + r.code : ''}`);

let head = null; // Head token, for cleanup in every case
let headVerified = false;
const ids = {};

async function main() {
  // ---------------------------------------------------------------- Phase 1
  const h = await call('GET', '/health');
  rec(h.status === 200, 'Phase 1: /health 200');
  const wp = await call('GET', '/api/public/web-push/config');
  rec(wp.data?.enabled === true, 'Phase 1: Web Push config enabled');

  // ---------------------------------------------------------------- Phase 2
  const headPw = pw();
  const reg = await call('POST', '/api/auth/register', null, { organizationName: ORG_NAME, email: QA_EMAIL, password: headPw });
  rec(reg.status === 201, `Phase 2: QA organization "${ORG_NAME}" registered -> ${reg.status}${reg.code ? ' ' + reg.code : ''}`);
  if (reg.status !== 201) return;
  head = reg.data.accessToken; console.log(`::add-mask::${head}`);
  if (reg.data.refreshToken) console.log(`::add-mask::${reg.data.refreshToken}`);
  ids.org = reg.data.organization.id;
  info(`QA organization id ${ids.org}; device identifier prefix ${RUN}-`);
  rec(reg.data.staff.status === 'PENDING_EMAIL_VERIFICATION', 'Phase 2: Head starts PENDING_EMAIL_VERIFICATION (verification not bypassed)');
  const gated = await call('GET', '/api/queues', head);
  check('Phase 2: unverified Head is kept out of queues', gated, 403, 'EMAIL_VERIFICATION_REQUIRED');

  // Browser tooling installs while we wait for the human to verify.
  const install = spawn('npx', ['playwright', 'install', '--with-deps', 'chromium'], { stdio: 'ignore' });
  const installed = new Promise((res) => install.on('exit', (c) => res(c === 0)));

  console.log('WAITING for the verification link to be clicked (up to 20 min)');
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const me = await call('GET', '/api/auth/me', head);
    if (me.data?.staff?.status === 'ACTIVE') { headVerified = true; break; }
    await sleep(15000);
  }
  rec(headVerified, 'Phase 2: Head email verified through the emailed link');
  if (!headVerified) return;
  head = await login(QA_EMAIL, headPw);

  // ---------------------------------------------------------------- Phase 3
  const org = await call('GET', '/api/organizations/me', head);
  rec(org.status === 200 && org.data.onboardingCompletedAt == null, 'Phase 3: fresh onboarding pending for the new Head');
  ids.publicCode = org.data.publicCode;
  const me = await call('GET', '/api/auth/me', head);
  rec(me.data?.staff?.role === 'OWNER', 'Phase 3: Head signs in (role key OWNER, shown as Organization Head)');

  const invite = async (token, name, email, role, extra = {}) => {
    const r = await call('POST', '/api/staff', token, { name, email, role, ...extra });
    return r;
  };
  const activate = async (token, staffId) => {
    const p = pw();
    const r = await call('PUT', `/api/staff/${staffId}`, token, { password: p });
    return { ok: r.status === 200, password: p, r };
  };
  const people = {};
  for (const [key, name, role] of [['adminA', 'QA Admin A', 'ADMIN'], ['adminB', 'QA Admin B', 'ADMIN'], ['manager', 'QA Manager', 'MANAGER']]) {
    const r = await invite(head, name, mail(key.toLowerCase()), role);
    rec(r.status === 201, `Phase 3: Head invites ${name} (${role}) -> ${r.status}`);
    const a = await activate(head, r.data.id);
    rec(a.ok, `Phase 3: Head activates ${name} via set-password (no extra email click)`);
    people[key] = { id: r.data.id, email: mail(key.toLowerCase()), password: a.password };
    people[key].token = await login(people[key].email, a.password);
  }

  // ---------------------------------------------------------------- Phase 4/5
  const A = people.adminA.token; const B = people.adminB.token; const M = people.manager.token;
  check('Phase 4: Admin cannot invite an Admin', await invite(A, 'Nope', mail('nope1'), 'ADMIN'), 403);
  check('Phase 4: Admin cannot invite a Manager', await invite(A, 'Nope', mail('nope2'), 'MANAGER'), 403);
  check('Phase 10/9: Manager cannot invite anyone', await invite(M, 'Nope', mail('nope3'), 'STAFF'), 403);
  for (const [key, name] of [['a1', 'QA Executive A1'], ['a2', 'QA Executive A2']]) {
    const r = await invite(A, name, mail(key), 'STAFF');
    rec(r.status === 201 && r.data.workspaceAdminId === people.adminA.id, `Phase 5: Admin A invites ${name} into Admin A's workspace`);
    let a = await activate(A, r.data.id);
    if (!a.ok) a = await activate(head, r.data.id);
    rec(a.ok, `Phase 5: ${name} activated`);
    people[key] = { id: r.data.id, email: mail(key), password: a.password };
    people[key].token = await login(people[key].email, a.password);
  }
  check('Phase 5: Admin B cannot see Executive A1', await call('GET', `/api/staff/${people.a1.id}`, B), 404);
  const listA = await call('GET', '/api/staff?pageSize=100', A);
  const namesA = (listA.data ?? []).map((s) => s.name);
  rec(namesA.includes('QA Executive A1') && !namesA.includes('QA Admin B'), 'Phase 4: Admin A staff list holds own workspace only');

  // ---------------------------------------------------------------- Phase 6
  const qA = await call('POST', '/api/queues', A, { name: 'QA Queue A', firstCounter: { name: 'Counter 1' } });
  rec(qA.status === 201, `Phase 6: Admin A creates "QA Queue A" (name -> first counter -> Assign Myself) -> ${qA.status}`);
  ids.qA = qA.data?.id;
  const cA = await call('GET', `/api/queues/${ids.qA}/counters`, A);
  const c1 = cA.data?.[0];
  rec(cA.data?.length === 1 && c1.name === 'Counter 1' && c1.status === 'ACTIVE' && c1.staffId === people.adminA.id,
    'Phase 6: atomic result — queue + "Counter 1" ACTIVE, operated by Admin A (no counterless queue)');
  ids.c1 = c1?.id;
  check('Phase 6: Admin A cannot create a second live queue', await call('POST', '/api/queues', A, { name: 'QA Queue A2' }), 409, 'ADMIN_ALREADY_HAS_QUEUE');
  const qB = await call('POST', '/api/queues', head, { name: 'QA Queue B', adminId: people.adminB.id, firstCounter: { name: 'B Counter 1' } });
  rec(qB.status === 201, `Phase 4: Head creates "QA Queue B" for Admin B -> ${qB.status}`);
  ids.qB = qB.data?.id;
  ids.bc1 = (await call('GET', `/api/queues/${ids.qB}/counters`, B)).data?.[0]?.id;
  check('Phase 3: Head cannot create a queue without naming an Admin', await call('POST', '/api/queues', head, { name: 'QA No Admin' }), 422, 'QUEUE_ADMIN_REQUIRED');

  // IDOR
  check('Phase 4 IDOR: Admin A reads Queue B by id', await call('GET', `/api/queues/${ids.qB}`, A), 404);
  check('Phase 4 IDOR: Admin A lists Queue B counters', await call('GET', `/api/queues/${ids.qB}/counters`, A), 404);
  check('Phase 4 IDOR: Admin A changes B counter status', await call('PATCH', `/api/counters/${ids.bc1}/status`, A, { status: 'ON_BREAK' }), 404);
  check('Phase 4 IDOR: Admin A edits Queue B', await call('PUT', `/api/queues/${ids.qB}`, A, { name: 'Hijack' }), 404);
  check('Phase 4 IDOR: Admin B reads Queue A', await call('GET', `/api/queues/${ids.qA}`, B), 404);
  check('Phase 4 IDOR: Executive A1 reads Queue B', await call('GET', `/api/queues/${ids.qB}`, people.a1.token), 404);

  // ---------------------------------------------------------------- Phase 8
  const svc = {};
  const sA = await call('POST', `/api/queues/${ids.qA}/services`, A, { serviceName: 'Service A', durationMinutes: 5 });
  rec(sA.status === 201 && sA.data.maxOccurrencesPerJourney === 2, 'Phase 8: Service A default max per visit = 2');
  svc.A = sA.data?.id;
  const sB = await call('POST', `/api/queues/${ids.qA}/services`, A, { serviceName: 'Service B', durationMinutes: 4, maxOccurrencesPerJourney: 2 });
  svc.B = sB.data?.id;
  const sC = await call('POST', `/api/queues/${ids.qA}/services`, A, { serviceName: 'Service C', durationMinutes: 3 });
  svc.C = sC.data?.id;
  const eC = await call('PUT', `/api/services/${svc.C}`, A, { maxOccurrencesPerJourney: 3 });
  rec(eC.status === 200 && eC.data.maxOccurrencesPerJourney === 3, 'Phase 8: Service C edited to max 3');
  check('Phase 8: max per visit above 10 refused', await call('PUT', `/api/services/${svc.C}`, A, { maxOccurrencesPerJourney: 11 }), 422);

  // ---------------------------------------------------------------- Phase 9
  check('Phase 9: recommended A,A,B refused', await call('PUT', `/api/queues/${ids.qA}/recommended-journey`, A, { serviceIds: [svc.A, svc.A, svc.B] }), 422, 'JOURNEY_CONSECUTIVE_REPEAT');
  check('Phase 9: recommended A,B,A,C,A refused (A max 2)', await call('PUT', `/api/queues/${ids.qA}/recommended-journey`, A, { serviceIds: [svc.A, svc.B, svc.A, svc.C, svc.A] }), 422, 'JOURNEY_REPEAT_LIMIT');
  const rj = await call('PUT', `/api/queues/${ids.qA}/recommended-journey`, A, { serviceIds: [svc.A, svc.B, svc.A] });
  const rjGet = await call('GET', `/api/queues/${ids.qA}/recommended-journey`, A);
  rec(rj.status === 200 && JSON.stringify(rjGet.data?.serviceIds) === JSON.stringify([svc.A, svc.B, svc.A]), 'Phase 9: recommended A -> B -> A saved and persists');
  check('Phase 10: Manager cannot change the recommended order', await call('PUT', `/api/queues/${ids.qA}/recommended-journey`, M, { serviceIds: [svc.B] }), 403);

  // ---------------------------------------------------------------- Phase 10 + 7
  rec((await call('PUT', `/api/counters/${ids.c1}/services`, A, { serviceIds: [svc.A] })).status === 200, 'Phase 10: Counter 1 -> Service A');
  const c2 = await call('POST', `/api/queues/${ids.qA}/counters`, A, { name: 'Counter 2', operatorStaffId: people.a1.id });
  rec(c2.status === 201 && c2.data.status === 'ACTIVE' && c2.data.staffId === people.a1.id, 'Phase 10: Counter 2 created ACTIVE with Executive A1');
  ids.c2 = c2.data?.id;
  rec((await call('PUT', `/api/counters/${ids.c2}/services`, A, { serviceIds: [svc.B, svc.C] })).status === 200, 'Phase 10: Counter 2 -> Services B + C');
  const c3 = await call('POST', `/api/queues/${ids.qA}/counters`, A, { name: 'Counter 3' });
  ids.c3 = c3.data?.id;
  rec(c3.status === 201 && c3.data.status === 'OFFLINE' && c3.data.staffId === null, 'Phase 7: new Counter 3 without operator is OFF');
  check('Phase 7: ACTIVE without operator refused', await call('PATCH', `/api/counters/${ids.c3}/status`, A, { status: 'ACTIVE' }), 409, 'COUNTER_OPERATOR_REQUIRED');
  const asg = await call('PATCH', `/api/counters/${ids.c3}/assign`, A, { staffId: people.a2.id });
  rec(asg.status === 200 && asg.data.status === 'ON_BREAK', `Phase 7: OFF + assign operator -> ${asg.data?.status} (PAUSED, not ACTIVE)`);
  const open3 = await call('PATCH', `/api/counters/${ids.c3}/status`, A, { status: 'ACTIVE' });
  rec(open3.data?.status === 'ACTIVE' && open3.data?.staffId === people.a2.id, 'Phase 7: explicit open -> ACTIVE with operator');
  const pause3 = await call('PATCH', `/api/counters/${ids.c3}/status`, A, { status: 'ON_BREAK' });
  rec(pause3.data?.status === 'ON_BREAK' && pause3.data?.staffId === people.a2.id, 'Phase 7: PAUSED keeps the operator');
  check('Phase 7: emptying a paused counter refused', await call('PATCH', `/api/counters/${ids.c3}/assign`, A, { staffId: null }), 409, 'COUNTER_MUST_BE_OFF');
  const off3 = await call('PATCH', `/api/counters/${ids.c3}/status`, A, { status: 'OFFLINE' });
  rec(off3.data?.status === 'OFFLINE' && off3.data?.staffId === null, 'Phase 7: OFF releases the operator');
  check('Phase 5: Executive A1 cannot hold a second counter', await call('PATCH', `/api/counters/${ids.c3}/assign`, A, { staffId: people.a1.id }), 409, 'OPERATOR_ALREADY_ASSIGNED');
  check('Phase 5: Admin B cannot assign Executive A1', await call('PATCH', `/api/counters/${ids.bc1}/assign`, B, { staffId: people.a1.id }), 409, 'OPERATOR_NOT_ASSIGNABLE');
  check('Phase 10: Manager cannot manage counters', await call('POST', `/api/queues/${ids.qA}/counters`, M, { name: 'X' }), 403);
  check('Phase 10: Manager cannot pause a queue', await call('PATCH', `/api/queues/${ids.qA}/status`, M, { status: 'PAUSED' }), 403);
  check('Phase 10: Manager cannot edit queue settings', await call('PUT', `/api/queues/${ids.qA}`, M, { name: 'X' }), 403);
  check('Phase 10: Manager cannot serve', await call('POST', `/api/queues/${ids.qA}/next`, M, {}), 403);

  // ---------------------------------------------------------------- Phase 11 (public)
  const pubOrg = await call('GET', `/api/public/organizations/${ids.publicCode}`);
  rec(pubOrg.status === 200 && pubOrg.data.queues.some((q) => q.name === 'QA Queue A'), 'Phase 18: organization QR route lists QA Queue A');
  const cfg = await call('GET', `/api/public/queues/${ids.qA}/config`);
  rec(JSON.stringify(cfg.data?.recommendedJourney) === JSON.stringify([svc.A, svc.B, svc.A])
    && cfg.data.services.find((s) => s.id === svc.C)?.maxOccurrencesPerJourney === 3, 'Phase 11: portal config carries recommended A,B,A and per-service limits');

  const join = async (serviceIds) => {
    const deviceIdentifier = dev();
    const r = await call('POST', '/api/tokens', null, { queueId: ids.qA, serviceIds, deviceIdentifier, formData: {} }, { 'Idempotency-Key': randomUUID() });
    return { r, id: r.data?.id, deviceIdentifier };
  };
  check('Phase 11: join A,A refused', (await join([svc.A, svc.A])).r, 422, 'JOURNEY_CONSECUTIVE_REPEAT');
  check('Phase 11: join A,B,A,C,A refused', (await join([svc.A, svc.B, svc.A, svc.C, svc.A])).r, 422, 'JOURNEY_REPEAT_LIMIT');
  const Y = await join([svc.B]);
  const Z = await join([svc.B]);
  const X = await join([svc.A, svc.B, svc.A]);
  rec(X.r.status === 201 && Y.r.status === 201 && Z.r.status === 201, 'Phase 11: tokens Y[B], Z[B], X[A,B,A] created via the public join');
  ids.X = X.id; ids.Y = Y.id; ids.Z = Z.id;
  const xv = await call('GET', `/api/tokens/${X.id}`);
  rec(xv.data?.journey?.totalSteps === 3 && xv.data.journey.current?.serviceName === 'Service A' && xv.data.journey.next?.serviceName === 'Service B',
    'Phase 11/12: person sees read-only progress — step 1 of 3, Service A, next Service B');
  for (const [m, p] of [['PUT', 'journey'], ['POST', 'services'], ['DELETE', 'steps'], ['PATCH', 'services']]) {
    check(`Phase 11: post-token ${m} /${p} locked`, await call(m, `/api/tokens/${X.id}/${p}`, null, { serviceIds: [svc.B] }), 409, 'JOURNEY_LOCKED');
  }

  // Socket.io: the person's token room receives the call.
  let socketEvent = null;
  try {
    const { io } = await import('socket.io-client');
    const s = io(API, { transports: ['websocket'], reconnection: false });
    await new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); setTimeout(() => rej(new Error('timeout')), 15000); });
    s.emit('join:token', { tokenId: X.id }, () => undefined);
    s.on('token.called', (d) => { socketEvent = d; });
    ids.socket = s;
    rec(true, 'Phase 18: Socket.io connects and joins the token room');
  } catch (e) { rec(false, `Phase 18: Socket.io connect failed: ${e}`); }

  // ---------------------------------------------------------------- Phase 12/13
  const nextAt = (tok) => call('POST', `/api/queues/${ids.qA}/next`, tok, {});
  const start = (tok, id) => call('POST', `/api/tokens/${id}/start`, tok, {});
  const complete = (tok, id, body = {}) => call('POST', `/api/tokens/${id}/complete`, tok, body);
  check('Phase 12: Counter 1 cannot call Z (Service B not at Counter 1)', await call('POST', `/api/tokens/${Z.id}/call`, A, {}), 409);
  const n2 = await nextAt(people.a1.token);
  rec(n2.data?.id === Y.id, 'Phase 12: Counter 2 serve-next gives Y (earliest Service B person, FCFS)');
  await start(people.a1.token, Y.id);
  check('Phase 12: Counter 2 cannot jump to Z while serving', await call('POST', `/api/tokens/${Z.id}/call`, people.a1.token, {}), 409);
  const n1 = await nextAt(A);
  rec(n1.data?.id === X.id, 'Phase 12: Counter 1 serve-next gives X (only Service A person)');
  await start(A, X.id);
  await sleep(1500);
  rec(socketEvent !== null, 'Phase 18: live update (token.called) delivered to the person\'s socket');
  const opts = await call('GET', `/api/tokens/${X.id}/referral-options`, A);
  rec(opts.data?.nextStep?.serviceName === 'Service B' && opts.data.currentCounterHandlesNext === false
    && opts.data.targets.some((t) => t.id === ids.c2 && t.busy) && !opts.data.targets.some((t) => t.id === ids.c3),
    'Phase 13: referral options — next Service B; Counter 2 (busy) offered; OFF Counter 3 not offered');
  check('Phase 13: referral to Admin B\'s counter refused', await complete(A, X.id, { referToCounterId: ids.bc1 }), 404, 'COUNTER_NOT_FOUND');
  const ref = await complete(A, X.id, { referToCounterId: ids.c2, referralNote: 'QA referral' });
  rec(ref.status === 200 && ref.data?.status === 'WAITING', 'Phase 13: X referred to Counter 2 (busy) -> WAITING for step 2');
  check('Phase 13: busy Counter 2 is not interrupted', await nextAt(people.a1.token), 409);
  rec((await call('GET', `/api/tokens/${Y.id}`)).data?.status === 'IN_PROGRESS', 'Phase 13: Y still IN_PROGRESS');
  await complete(people.a1.token, Y.id);
  const n2b = await nextAt(people.a1.token);
  rec(n2b.data?.id === X.id, 'Phase 13: after Y, the referred X is next at Counter 2 — ahead of Z who joined earlier');
  await start(people.a1.token, X.id);
  const mid = await complete(people.a1.token, X.id, { feedback: 'QA mid-visit note' });
  if (mid.status !== 200) { info(`mid-visit feedback refused (${mid.status} ${mid.code}); completing step without it`); await complete(people.a1.token, X.id); }
  const xMid = await call('GET', `/api/tokens/${X.id}`);
  rec(xMid.data?.status === 'WAITING' && !xMid.data?.completionFeedback && xMid.data.journey.currentStepNumber === 3,
    'Phase 15: step 2 done -> back in line for step 3; no completion feedback mid-visit');

  // ---------------------------------------------------------------- Phase 15
  const n1b = await nextAt(A);
  rec(n1b.data?.id === X.id, 'Phase 15: Counter 1 calls X for step 3 (Service A again)');
  await start(A, X.id);
  const fin = await complete(A, X.id, { feedback: 'Thank you from QA' });
  const xEnd = await call('GET', `/api/tokens/${X.id}`);
  rec(fin.status === 200 && xEnd.data?.status === 'COMPLETED' && xEnd.data.completionFeedback === 'Thank you from QA',
    'Phase 15: final completion -> COMPLETED with feedback shown to the person');

  // ---------------------------------------------------------------- Phase 14 (fallback)
  const W = await join([svc.A, svc.B]);
  await call('PUT', `/api/counters/${ids.c3}/services`, A, { serviceIds: [svc.B] });
  await call('PATCH', `/api/counters/${ids.c3}/status`, A, { status: 'ACTIVE', operatorStaffId: people.a2.id });
  rec((await nextAt(A)).data?.id === W.id, 'Phase 14: Counter 1 calls W');
  await start(A, W.id);
  const wr = await complete(A, W.id, { referToCounterId: ids.c3 });
  rec(wr.status === 200, 'Phase 14: W referred to Counter 3 (idle)');
  await call('PATCH', `/api/counters/${ids.c3}/status`, A, { status: 'OFFLINE' });
  const n2c = await nextAt(people.a1.token);
  rec(n2c.data?.id === W.id, 'Phase 14: target turned OFF -> Counter 2 takes W with referral priority, ahead of Z');
  await start(people.a1.token, W.id);
  await complete(people.a1.token, W.id);
  rec((await nextAt(people.a1.token)).data?.id === Z.id, 'Phase 12: then strict FCFS resumes: Z');
  await start(people.a1.token, Z.id); await complete(people.a1.token, Z.id);

  const U = await join([svc.A, svc.B]);
  await call('PATCH', `/api/counters/${ids.c3}/status`, A, { status: 'ACTIVE', operatorStaffId: people.a2.id });
  await nextAt(A); await start(A, U.id);
  await complete(A, U.id, { referToCounterId: ids.c3 });
  await call('PATCH', `/api/counters/${ids.c3}/status`, A, { status: 'OFFLINE' });
  await call('PATCH', `/api/counters/${ids.c2}/status`, A, { status: 'OFFLINE' });
  const uWait = await call('GET', `/api/tokens/${U.id}`);
  rec(uWait.data?.status === 'WAITING', 'Phase 14: no open Service B counter -> U waits safely (WAITING)');
  check('Phase 14: Counter 1 cannot take U\'s Service B step', await nextAt(A), 404, 'NO_ELIGIBLE_TOKENS');
  await call('PATCH', `/api/counters/${ids.c2}/status`, A, { status: 'ACTIVE', operatorStaffId: people.a1.id });
  const n2d = await nextAt(people.a1.token);
  rec(n2d.data?.id === U.id, 'Phase 14: Counter 2 reopens -> U served first');
  await start(people.a1.token, U.id); await complete(people.a1.token, U.id);

  // ---------------------------------------------------------------- Phase 15/16 history, audit, reports
  const hist = await call('GET', '/api/service-history?pageSize=50', A);
  const xRow = hist.data?.find((r) => r.tokenId === X.id);
  const wRow = hist.data?.find((r) => r.tokenId === W.id);
  rec(xRow?.journey?.length === 3 && xRow.journey.every((s) => s.counter && s.executiveName && s.completedAt)
    && xRow.journey[1].referral?.to?.name === 'Counter 2' && xRow.journey[1].referral?.note === 'QA referral',
    'Phase 15: X history — 3 steps, each with counter, operator and times; step 2 referral Counter 1 -> Counter 2 with note');
  rec(wRow?.journey?.[1]?.referral?.rerouted === true && wRow.journey[1].counter?.name === 'Counter 2',
    'Phase 14/15: W history marks the referral rerouted to Counter 2');
  const audA = await call('GET', '/api/audit-logs?search=token_referred&pageSize=50', A);
  const audB = await call('GET', '/api/audit-logs?search=token_referred&pageSize=50', B);
  const audM = await call('GET', `/api/audit-logs?search=token_referred&pageSize=50&adminId=${people.adminA.id}`, M);
  const audH = await call('GET', '/api/audit-logs?search=token_referred&pageSize=50', head);
  rec((audA.data?.length ?? 0) >= 3 && audB.data?.length === 0 && audM.data?.length === audA.data?.length && audH.data?.length === audA.data?.length,
    `Phase 16: referral audit — Admin A ${audA.data?.length}, Admin B ${audB.data?.length}, Manager (filter A) ${audM.data?.length}, Head ${audH.data?.length}`);
  const repA = await call('GET', '/api/reports?range=today', A);
  const repB = await call('GET', '/api/reports?range=today', B);
  const repH = await call('GET', `/api/reports?range=today&adminId=${people.adminA.id}`, head);
  rec(repA.data?.referrals?.length > 0 && repA.data.queuePerformance.every((q) => q.queueName === 'QA Queue A'),
    'Phase 16: Admin A report — own queue only, referrals listed');
  rec(repB.data?.referrals?.length === 0 && !repB.data.queuePerformance.some((q) => q.queueName === 'QA Queue A'), 'Phase 16: Admin B report shows none of Admin A\'s data');
  rec(repH.data?.referrals?.length === repA.data?.referrals?.length && (repH.data?.serviceSteps?.length ?? 0) >= 2, 'Phase 16: Head report with Admin filter shows referrals and per-service steps');
  const qM = await call('GET', '/api/queues', M);
  const qMf = await call('GET', `/api/queues?adminId=${people.adminA.id}`, M);
  rec(qM.data?.length === 2 && qMf.data?.length === 1 && qM.data.every((q) => q.canManage === false), 'Phase 16: Manager sees both workspaces, filters by Admin, can manage none');

  // ---------------------------------------------------------------- Phase 17 (Queue B)
  const sD = await call('POST', `/api/queues/${ids.qB}/services`, B, { serviceName: 'Service D', durationMinutes: 3 });
  const joinB = async () => (await call('POST', '/api/tokens', null, { queueId: ids.qB, serviceIds: [sD.data.id], deviceIdentifier: dev(), formData: {} }, { 'Idempotency-Key': randomUUID() })).data?.id;
  const t1 = await joinB();
  await call('POST', `/api/queues/${ids.qB}/next`, B, {}); await call('POST', `/api/tokens/${t1}/start`, B, {});
  check('Phase 17: delete without a reason refused', await call('DELETE', `/api/queues/${ids.qB}`, M, {}), 422);
  check('Phase 17: delete while someone is IN_PROGRESS refused', await call('DELETE', `/api/queues/${ids.qB}`, M, { reason: 'QA closing B' }), 409, 'QUEUE_HAS_ACTIVE_SERVICE');
  await call('POST', `/api/tokens/${t1}/complete`, B, {});
  const t2 = await joinB();
  const del = await call('DELETE', `/api/queues/${ids.qB}`, M, { reason: 'QA closing B' });
  rec(del.status === 200, 'Phase 17/10: Organization Manager deletes Queue B with a reason');
  const t2v = await call('GET', `/api/tokens/${t2}`);
  const t1v = await call('GET', `/api/tokens/${t1}`);
  rec(t2v.data?.status === 'CANCELLED' && t2v.data.queueRemoved?.reason === 'QA closing B', 'Phase 17: waiting person cancelled and sees the reason');
  rec(t1v.data?.status === 'COMPLETED' && !t1v.data.queueRemoved, 'Phase 17: completed person unaffected, sees no reason');
  const pubAfter = await call('GET', `/api/public/organizations/${ids.publicCode}`);
  const cfgB = await call('GET', `/api/public/queues/${ids.qB}/config`);
  rec(!pubAfter.data?.queues?.some((q) => q.name === 'QA Queue B') && cfgB.status === 404 && !JSON.stringify(pubAfter.body).includes('QA closing B'),
    'Phase 17: public visitors see no Queue B and no deletion reason');
  const delList = await call('GET', '/api/queues/deleted', head);
  const dq = delList.data?.find((q) => q.id === ids.qB);
  rec(dq?.deletionReason === 'QA closing B' && dq.deletedByRole === 'MANAGER' && dq.deletedByEmail === people.manager.email, 'Phase 17: deletion record keeps who, role and reason');
  const repeatJoin = await call('POST', '/api/tokens', null, { queueId: ids.qA, serviceIds: [svc.B], deviceIdentifier: dev(), formData: {} }, { 'Idempotency-Key': randomUUID() });
  rec(repeatJoin.status === 201, 'Phase 15: repeat visits still allowed on an unrestricted queue');

  // ---------------------------------------------------------------- UI (dashboard + portal)
  if (await installed) {
    try { await ui({ head: { email: QA_EMAIL, password: headPw }, adminA: people.adminA, qA: ids.qA, publicCode: ids.publicCode }); }
    catch (e) { rec(false, `UI: ${String(e).slice(0, 200)}`); }
  } else rec(false, 'UI: browser install failed');
  ids.socket?.close();
}

async function ui({ head: hc, adminA, qA, publicCode }) {
  const { chromium, devices } = await import('playwright');
  const browser = await chromium.launch();
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desk.newPage();
  const loginUi = async (email, password) => {
    await page.goto(`${WEB}/login`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/dashboard', { timeout: 60000 });
  };
  await loginUi(hc.email, hc.password);
  await page.getByText('Organization Head').first().waitFor({ timeout: 30000 });
  rec(await page.getByText('Organization Head').first().isVisible(), 'UI: Head sees "Organization Head" label');
  await page.goto(`${WEB}/staff`);
  await page.getByText('QA Executive A1').first().waitFor({ timeout: 30000 });
  const body = await page.locator('body').innerText();
  rec(body.includes('Executive') && body.includes('Organization Manager') && !/\b(OWNER|STAFF|MANAGER)\b/.test(body), 'UI: staff list shows role labels, no internal enum names');
  await page.goto(`${WEB}/queues`);
  await page.getByRole('cell', { name: 'QA Admin A' }).first().waitFor({ timeout: 30000 });
  rec(true, 'UI: Head queue list shows the Admin column');
  await desk.clearCookies(); await page.evaluate(() => localStorage.clear());

  await loginUi(adminA.email, adminA.password);
  await page.goto(`${WEB}/queues/${qA}?tab=services`);
  const hA = page.getByRole('button', { name: /Reorder step 3, Service A/ });
  await hA.waitFor({ timeout: 30000 });
  const h1 = page.getByRole('button', { name: /Reorder step 1, Service A/ });
  const ba = await hA.boundingBox(); const b1 = await h1.boundingBox();
  await page.mouse.move(ba.x + ba.width / 2, ba.y + ba.height / 2); await page.mouse.down();
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2 + 30, { steps: 8 }); await page.mouse.up();
  const order = (await page.locator('ol[aria-label="Steps in order"] li .truncate').allTextContents()).map((t) => t.replace(/Step \d+: /, ''));
  rec(order.join(',') === 'Service A,Service A,Service B', `UI: drag reorders and renumbers (${order.join(',')})`);
  rec(await page.getByText("Service A can't be two steps in a row.").isVisible() && await page.getByRole('button', { name: 'Save order' }).isDisabled(),
    'UI: consecutive duplicate flagged, Save disabled');
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await page.goto(`${WEB}/queues/${qA}/counters`);
  await page.getByRole('button', { name: 'Assign', exact: true }).first().waitFor({ timeout: 30000 });
  rec(await page.getByText(/Off → operator assigned →/).isVisible(), 'UI: Off counter explains Off -> assigned -> Paused');

  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await phone.newPage();
  await p.goto(`${WEB}/visit/${publicCode}`);
  await p.getByText('QA Queue A').first().waitFor({ timeout: 30000 });
  rec(true, 'UI portal: organization page lists QA Queue A');
  await p.goto(`${WEB}/visit/${publicCode}/q/${qA}`);
  await p.getByRole('heading', { name: 'QA Queue A' }).waitFor({ timeout: 30000 });
  const pre = (await p.locator('ol[aria-label="Steps in order"] li .truncate').allTextContents()).map((t) => t.replace(/Step \d+: /, ''));
  rec(pre.join(',') === 'Service A,Service B,Service A', `UI portal: starts from recommended order (${pre.join(',')})`);
  await p.getByRole('button', { name: 'Remove step 2, Service B' }).click();
  rec(await p.getByText("Service A can't be two steps in a row.").isVisible() && await p.getByRole('button', { name: 'Join queue' }).isDisabled(),
    'UI portal: A,A blocked before token creation');
  const sw = await p.request.get(`${WEB}/portal-sw.js`);
  rec(sw.status() === 200, 'UI portal: service worker loads');
  await browser.close();
}

async function cleanup() {
  if (!head) return;
  const tok = headVerified ? head : head;
  const aud = await call('GET', '/api/audit-logs?page=1&pageSize=1', tok);
  info(`QA audit rows before deletion (Head, organization-wide): ${aud.body?.pagination?.total ?? 'unavailable (' + aud.status + ')'}; deletion adds 1 (organization_deletion_requested)`);
  const r = await call('DELETE', '/api/organizations/me', tok, { confirmName: ORG_NAME });
  rec(r.status === 200 || r.status === 204, `Phase 19: QA organization deleted through "Delete organization" -> ${r.status}${r.code ? ' ' + r.code : ''}`);
  if (ids.publicCode) {
    const pub = await call('GET', `/api/public/organizations/${ids.publicCode}`);
    rec(pub.status === 404, 'Phase 20: QA organization no longer public');
  }
  for (const [label, id] of [['X', ids.X], ['Y', ids.Y], ['Z', ids.Z]]) if (id) {
    const t = await call('GET', `/api/tokens/${id}`);
    rec(t.status === 404, `Phase 20: QA token ${label} gone (${t.status})`);
  }
  if (ids.qA) rec((await call('GET', `/api/public/queues/${ids.qA}/config`)).status === 404, 'Phase 20: QA Queue A gone');
  const meGone = await call('GET', '/api/auth/me', tok);
  rec(meGone.status === 401, `Phase 20: QA Head session no longer valid (${meGone.status})`);
  info(`QA device identifiers used: ${devices.size} (all start with ${RUN}-)`);
  rec((await call('GET', '/health')).status === 200, 'Phase 20: /health 200 after cleanup');
}

try { await main(); }
catch (e) { rec(false, `unexpected: ${String(e).slice(0, 300)}`); }
finally {
  try { await cleanup(); } catch (e) { rec(false, `cleanup error: ${String(e).slice(0, 200)}`); }
  const text = results.join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', text + '\n');
  // Annotations hold up to 64 KB; split to stay readable.
  const chunks = []; let cur = '';
  for (const line of results) { if ((cur + line).length > 3500) { chunks.push(cur); cur = ''; } cur += (cur ? ' | ' : '') + line; }
  if (cur) chunks.push(cur);
  chunks.forEach((c, i) => console.log(`::notice title=e2e-${String(i + 1).padStart(2, '0')}::${c}`));
  writeFileSync('/tmp/e2e-done', failed ? 'fail' : 'ok');
  process.exit(failed ? 1 : 0);
}

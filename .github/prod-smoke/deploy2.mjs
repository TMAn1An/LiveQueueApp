// Post-deploy smoke for ADR-069/070 (read-only: no writes to production).
import { appendFileSync } from 'node:fs';
const { API, WEB, EXPECTED_VAPID_PUBLIC_KEY, ORG_CODE } = process.env;
const lines = [];
let failed = false;
const rec = (ok, m) => { lines.push(`${ok ? 'PASS' : 'FAIL'} ${m}`); if (!ok) failed = true; };
const get = async (url, init) => {
  try { const r = await fetch(url, init); return { status: r.status, headers: r.headers, text: await r.text() }; }
  catch (e) { return { status: 0, headers: new Headers(), text: String(e) }; }
};
const wait = async (label, fn, tries = 90) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return i; await new Promise((r) => setTimeout(r, 20000)); }
  return -1;
};
const zero = '00000000-0000-4000-8000-000000000000';

// 1. New backend live: the journey-lock route only exists after this deploy.
const n = await wait('backend', async () => {
  const r = await get(`${API}/api/tokens/${zero}/journey`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
  return r.status === 409 && /JOURNEY_LOCKED/.test(r.text);
});
rec(n >= 0, `new backend live (PUT /api/tokens/:id/journey -> 409 JOURNEY_LOCKED) after ~${Math.max(n, 0) * 20}s`);

const health = await get(`${API}/health`);
rec(health.status === 200, `/health ${health.status} ${health.text.slice(0, 120)}`);

const cfg = JSON.parse((await get(`${API}/api/public/web-push/config`)).text || '{}').data ?? {};
rec(cfg.enabled === true && cfg.vapidPublicKey === EXPECTED_VAPID_PUBLIC_KEY && Object.keys(cfg).length === 2,
  'Web Push enabled, same VAPID public key, config exposes nothing else');

const unknownOrg = await get(`${API}/api/public/organizations/zzzz00000000`);
rec(unknownOrg.status === 404 && /ORGANIZATION_NOT_FOUND/.test(unknownOrg.text), 'public organization route: unknown code 404');
const legacy = await get(`${API}/api/public/queues/${zero}/config`);
rec(legacy.status === 404, `legacy queue config route answers (${legacy.status} for unknown id)`);

// New authenticated endpoints refuse anonymous callers (no 500s).
for (const [method, path] of [
  ['GET', '/api/queues/deleted'], ['GET', `/api/queues/${zero}/recommended-journey`], ['PUT', `/api/queues/${zero}/recommended-journey`],
  ['PATCH', `/api/queues/${zero}/admin`], ['PUT', `/api/counters/${zero}/services`], ['GET', `/api/tokens/${zero}/referral-options`],
  ['PATCH', `/api/staff/${zero}/workspace`], ['DELETE', `/api/queues/${zero}`], ['GET', '/api/queues'], ['GET', '/api/reports?range=today'],
]) {
  const r = await get(`${API}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
  rec(r.status === 401, `${method} ${path} anonymous -> ${r.status}`);
}

// Socket.io handshake.
const sock = await get(`${API}/socket.io/?EIO=4&transport=polling`);
rec(sock.status === 200 && /"sid"/.test(sock.text), `Socket.io polling handshake ${sock.status}`);

// Real organization (public data only): the new public config fields.
if (ORG_CODE) {
  const org = JSON.parse((await get(`${API}/api/public/organizations/${ORG_CODE}`)).text || '{}').data;
  rec(Boolean(org?.organization?.name), `organization ${ORG_CODE} lists ${org?.queues?.length ?? 0} queue(s)`);
  for (const q of org?.queues ?? []) {
    const c = JSON.parse((await get(`${API}/api/public/queues/${q.id}/config`)).text || '{}').data;
    rec(Array.isArray(c?.recommendedJourney) && (c?.services ?? []).every((s) => Number.isInteger(s.maxOccurrencesPerJourney)),
      `queue config ${q.name}: recommendedJourney[${c?.recommendedJourney?.length}] and per-service repeat limits present`);
  }
} else rec(true, 'no SMOKE_ORG_CODE — real-organization checks skipped');

// 2. Cloudflare Pages: new bundles live.
const bundleHas = async (page, needle) => {
  const html = (await get(`${WEB}${page}`)).text;
  const js = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const a of js) { if ((await get(`${WEB}${a}`)).text.includes(needle)) return true; }
  return false;
};
const p = await wait('pages', () => bundleHas('/login', 'Organization Manager'), 45);
rec(p >= 0, `dashboard bundle is the new build (role labels) after ~${Math.max(p, 0) * 20}s`);
for (const needle of ['Off → operator assigned', 'Signing you in…', 'Creating your organization…', 'Reason (required)', 'Recommended Order', 'Complete and refer']) {
  rec(await bundleHas('/login', needle), `dashboard bundle contains "${needle}"`);
}
rec(await bundleHas('/visit/zzzz00000000', 'Your services, in order'), 'portal bundle contains the ordered journey builder');
rec(await bundleHas('/visit/zzzz00000000', 'Your service steps'), 'portal bundle contains the read-only journey progress');
const sw = await get(`${WEB}/portal-sw.js`);
rec(sw.status === 200 && /showNotification/.test(sw.text), 'portal service worker (Web Push) intact');

const summary = lines.join('\n');
console.log(summary);
appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', summary + '\n');
console.log(`::notice title=deploy-smoke::${lines.join(' | ').replace(/[\r\n]/g, ' ')}`);
process.exit(failed ? 1 : 0);

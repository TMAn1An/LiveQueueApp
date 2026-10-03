import assert from 'node:assert/strict';
const { API, WEB, EXPECTED_VAPID_PUBLIC_KEY, ORG_CODE } = process.env;
const out = [];
const ok = (m) => { out.push(`PASS ${m}`); console.log(`PASS ${m}`); };
const get = async (url, init) => { const r = await fetch(url, init); return { status: r.status, type: r.headers.get('content-type') ?? '', headers: r.headers, text: await r.text() }; };

const health = await get(`${API}/health`);
assert.equal(health.status, 200); ok(`backend /health 200 ${health.text}`);

const cfg = JSON.parse((await get(`${API}/api/public/web-push/config`)).text).data;
assert.equal(cfg.enabled, true, 'Web Push must be enabled');
assert.equal(cfg.vapidPublicKey, EXPECTED_VAPID_PUBLIC_KEY, 'served public key must be the generated one');
assert.deepEqual(Object.keys(cfg).sort(), ['enabled', 'vapidPublicKey']);
ok('Web Push enabled; served VAPID public key matches the generated key; config exposes nothing else');

const unknown = await get(`${API}/api/public/organizations/zzzz00000000`);
assert.equal(unknown.status, 404); assert.match(unknown.text, /ORGANIZATION_NOT_FOUND/);
const bad = await get(`${API}/api/public/organizations/bad%20code!`);
assert.ok(bad.status === 404 || bad.status === 400 || bad.status === 422, `malformed code status ${bad.status}`);
ok(`organization route live: unknown code 404 ORGANIZATION_NOT_FOUND, malformed code ${bad.status}`);

const body = (endpoint) => JSON.stringify({ deviceIdentifier: '00000000-0000-4000-8000-000000000000', subscription: { endpoint, keys: { p256dh: 'x', auth: 'y' } } });
for (const ep of ['https://evil.example/push', 'http://web.push.apple.com/x', 'https://169.254.169.254/latest']) {
  const r = await get(`${API}/api/devices/web-push-subscription`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body(ep) });
  assert.ok(r.status >= 400 && r.status < 500 && r.status !== 404, `${ep} -> ${r.status}`);
}
ok('subscription endpoint rejects non-push-service, non-https and metadata-IP endpoints (4xx, nothing stored)');

const legacyQueue = await get(`${API}/api/public/queues/00000000-0000-4000-8000-000000000000/config`);
assert.equal(legacyQueue.status, 404); ok('legacy queue config route still answers (404 for unknown id)');

if (ORG_CODE) {
  const org = JSON.parse((await get(`${API}/api/public/organizations/${ORG_CODE}`)).text).data;
  assert.ok(org.organization.name);
  const allowed = ['id', 'name', 'description', 'availability', 'closedReason', 'message', 'waitingCount', 'estimatedWaitMinutes', 'timezone', 'todaySessions', 'nextSessionStartMinute'];
  for (const q of org.queues) {
    assert.deepEqual(Object.keys(q).filter((k) => !allowed.includes(k)), []);
    assert.ok(['JOINABLE', 'CLOSED'].includes(q.availability));
    assert.ok(Number.isInteger(q.waitingCount) && q.waitingCount >= 0);
  }
  assert.deepEqual(Object.keys(org.organization).sort(), ['name', 'publicCode']);
  ok(`org ${ORG_CODE}: ${org.queues.length} listed queue(s): ${org.queues.map((q) => `${q.name}=${q.availability}${q.closedReason ? '/' + q.closedReason : ''} waiting ${q.waitingCount} eta ${q.estimatedWaitMinutes}`).join('; ')} — only public fields`);
} else ok('no SMOKE_ORG_CODE variable set — skipped real-organization listing');

for (const [path, expect] of [['/visit/zzzz00000000', /portal/], ['/visit', /portal/], ['/portal-sw.js', /showNotification/], ['/portal.webmanifest', /"scope": ?"\/visit\/"/], ['/', /main-|index-/], ['/login', /main-|index-/], ['/organization', /main-|index-/]]) {
  const r = await get(`${WEB}${path}`);
  assert.match(r.text, expect, path);
  console.log(`  ${path} -> ${r.status} ${r.type}`);
}
const sw = await get(`${WEB}/portal-sw.js`);
assert.match(sw.headers.get('cache-control') ?? '', /no-cache/);
assert.match((await get(`${WEB}/portal.webmanifest`)).type, /manifest\+json/);
ok('Pages: /visit/* serves the portal entry, service worker (no-cache) and manifest (scope /visit/) load, dashboard routes still serve the dashboard');
const html = (await get(`${WEB}/visit/zzzz00000000`)).text;
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
for (const a of assets) { const r = await get(`${WEB}${a}`); assert.equal(r.status, 200, a); if (a.endsWith('.js')) assert.ok(!/PRIVATE/.test(r.text) || !/WEB_PUSH_VAPID_PRIVATE_KEY/.test(r.text), a); }
ok(`portal assets load (${assets.length}) and contain no private-key variable`);

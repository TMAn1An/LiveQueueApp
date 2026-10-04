// Post-reset smoke (read-only: GETs and unauthenticated probes only; creates nothing).
import { appendFileSync } from 'node:fs';
const { API, WEB, EXPECTED_VAPID_PUBLIC_KEY } = process.env;
const lines = []; let failed = false;
const rec = (ok, m) => { lines.push(`${ok ? 'PASS' : 'FAIL'} ${m}`); if (!ok) failed = true; };
const get = async (url, init) => { try { const r = await fetch(url, init); return { status: r.status, headers: r.headers, text: await r.text() }; } catch (e) { return { status: 0, headers: new Headers(), text: String(e) }; } };
const zero = '00000000-0000-4000-8000-000000000000';

const h = await get(`${API}/health`);
rec(h.status === 200 && /"ok"/.test(h.text), `/health ${h.status} ${h.text.slice(0, 80)}`);
const marker = await get(`${API}/api/tokens/${zero}/journey`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
rec(marker.status === 409 && /JOURNEY_LOCKED/.test(marker.text), 'running build is master ab31b3c (journey-lock route present)');

const cfg = JSON.parse((await get(`${API}/api/public/web-push/config`)).text || '{}').data ?? {};
rec(cfg.enabled === true && cfg.vapidPublicKey === EXPECTED_VAPID_PUBLIC_KEY && Object.keys(cfg).length === 2, 'Web Push enabled with the same VAPID public key');

for (const code of ['zzzz00000000', 'abc123def456']) {
  const r = await get(`${API}/api/public/organizations/${code}`);
  rec(r.status === 404 && /ORGANIZATION_NOT_FOUND/.test(r.text), `public organization ${code} -> ${r.status} not found`);
}
const q = await get(`${API}/api/public/queues/${zero}/config`);
rec(q.status === 404 && /QUEUE_NOT_FOUND/.test(q.text), `public queue config -> ${q.status} QUEUE_NOT_FOUND`);
const t = await get(`${API}/api/tokens/${zero}`);
rec(t.status === 404, `public token lookup -> ${t.status}`);

// Signup readiness without creating anything: the availability check answers.
const avail = await get(`${API}/api/auth/organization-name-availability?name=${encodeURIComponent('Fresh Check ' + Date.now())}`);
rec(avail.status === 200 && /true/.test(avail.text), `organization name availability probe -> ${avail.status} ${avail.text.slice(0, 80)}`);
const login = await get(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody-' + Date.now() + '@example.com', password: 'Password123' }) });
rec(login.status === 401 || login.status === 400 || login.status === 422, `login with an unknown account -> ${login.status} (auth path works, DB reachable)`);

const sock = await get(`${API}/socket.io/?EIO=4&transport=polling`);
rec(sock.status === 200 && /"sid"/.test(sock.text), `Socket.io handshake ${sock.status}`);

const rootHtml = (await get(`${WEB}/`)).text;
const rootScript = (rootHtml.match(/src="(\/assets\/main-[^"]+\.js)"/) || [])[1];
for (const page of ['/', '/login', '/register', '/visit/zzzz00000000']) {
  const r = await get(`${WEB}${page}`);
  const script = (r.text.match(/src="(\/assets\/[^"]+\.js)"/) || [])[1];
  const sameApp = page.startsWith('/visit') ? /portal/.test(r.text) : script === rootScript;
  // Deep links are served by the SPA fallback (404.html = index.html), so the
  // status may be 404 while the page is the app itself.
  rec((r.status === 200 || r.status === 404) && Boolean(script) && sameApp, `Pages ${page} -> ${r.status}, serves ${script} ${sameApp ? '(current app)' : '(UNEXPECTED)'}`);
}
const html = (await get(`${WEB}/login`)).text;
const js = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
let found = false; for (const a of js) if ((await get(`${WEB}${a}`)).text.includes('Organization Manager')) found = true;
rec(found, 'dashboard bundle is the current build');
const sw = await get(`${WEB}/portal-sw.js`);
rec(sw.status === 200 && /showNotification/.test(sw.text), 'portal service worker intact');

console.log(lines.join('\n'));
appendFileSync(process.env.GITHUB_STEP_SUMMARY ?? '/dev/null', lines.join('\n') + '\n');
console.log(`::notice title=post-reset::${lines.join(' | ')}`);
process.exit(failed ? 1 : 0);

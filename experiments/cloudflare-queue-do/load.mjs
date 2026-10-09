// Synthetic local load for the POC (wrangler dev). Not a Cloudflare capacity test.
// usage: node load.mjs <visitors> [events]
const BASE = 'http://127.0.0.1:8787';
const N = Number(process.argv[2] ?? 100);
const EVENTS = Number(process.argv[3] ?? 10);
const queueId = `poc-${N}-${Date.now()}`;
let requests = 0;
const post = async (path, token) => { requests++; const r = await fetch(BASE + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); };
const mint = async (role, sub) => { const r = await fetch(BASE + '/poc/token', { method: 'POST', body: JSON.stringify({ sub, role, queueId, exp: Math.floor(Date.now() / 1000) + 3600 }) }); return (await r.json()).token; };

const staffTok = await mint('staff', 'staff-1');
// Visitors join (quiet: no broadcast per join, to keep setup O(N)).
const vis = [];
for (let i = 0; i < N; i += 50) {
  await Promise.all(Array.from({ length: Math.min(50, N - i) }, async (_, k) => {
    const sub = `v-${i + k}`; const tok = await mint('visitor', sub);
    await post(`/queues/${queueId}/join?quiet=1`, tok); vis.push(tok);
  }));
}
// Unauthenticated / wrong-role requests are refused by the Worker before the DO.
const unauth = (await fetch(`${BASE}/queues/${queueId}/serve-next`, { method: 'POST' })).status;
const forbidden = (await fetch(`${BASE}/queues/${queueId}/serve-next`, { method: 'POST', headers: { Authorization: `Bearer ${vis[0]}` } })).status;

let got = 0, bytes = 0, staffBytes = 0, staffMsgs = 0, lastAt = 0;
const open = (tok, isStaff) => new Promise((res, rej) => {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/queues/${queueId}/ws?access_token=${tok}`);
  ws.onopen = () => res(ws); ws.onerror = rej;
  ws.onmessage = (m) => { got++; bytes += m.data.length; lastAt = performance.now(); if (isStaff) { staffMsgs++; staffBytes += m.data.length; } };
});
const t0 = performance.now();
const sockets = [await open(staffTok, true)];
for (let i = 0; i < vis.length; i += 100) sockets.push(...(await Promise.all(vis.slice(i, i + 100).map((t) => open(t, false)))));
const connectMs = performance.now() - t0;

const rows = [];
for (let e = 0; e < EVENTS; e++) {
  got = 0; bytes = 0; staffBytes = 0; staffMsgs = 0;
  const expected = sockets.length; // 1 staff + 1 per connected visitor
  const s = performance.now();
  await post(`/queues/${queueId}/serve-next?counter=1`, staffTok);
  const ack = performance.now() - s;
  while (got < expected && performance.now() - s < 10000) await new Promise((r) => setTimeout(r, 2));
  rows.push({ ack, all: lastAt - s, got, bytes, staffBytes });
}
const stats = await (await fetch(`${BASE}/queues/${queueId}/stats`, { headers: { Authorization: `Bearer ${staffTok}` } })).json();
const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(JSON.stringify({
  visitors: N, sockets: sockets.length, connectMs: Math.round(connectMs), unauthStatus: unauth, visitorServeNextStatus: forbidden,
  perServeNext: {
    httpRequests: 1, messagesDelivered: rows[0].got, medianAckMs: +med(rows.map((r) => r.ack)).toFixed(1), medianAllDeliveredMs: +med(rows.map((r) => r.all)).toFixed(1),
    bytesToStaffTab: rows[0].staffBytes, bytesToAllVisitors: rows[0].bytes - rows[0].staffBytes,
  },
  doStats: stats, setupRequests: requests,
}));
for (const ws of sockets) ws.close();
process.exit(0);

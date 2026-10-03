import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
const WEB = process.env.WEB, CODE = process.env.ORG_CODE;
const browser = await chromium.launch();
const iphone = devices['iPhone 15'];
const cases = [
  ['iPhone Safari profile', iphone, null],
  ['Android', devices['Pixel 7'], 'LiveQueue for Android is available through the Android app.'],
  ['Desktop', devices['Desktop Chrome'], 'This portal is designed for iPhone and iPad.'],
  ['iOS Chrome', { ...iphone, userAgent: iphone.userAgent.replace(/Version\/[\d.]+ /, 'CriOS/129.0.6668.69 ') }, 'Open this link in Safari to use LiveQueue.'],
];
const errors = [];
for (const [name, profile, message] of cases) {
  const page = await (await browser.newContext(profile)).newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${WEB}/visit/${CODE || 'zzzz00000000'}`);
  if (message) {
    await page.getByText(message).waitFor({ timeout: 30000 });
    console.log(`PASS ${name}: "${message}"`);
  } else if (CODE) {
    await page.getByRole('list', { name: 'Queues' }).waitFor({ timeout: 60000 });
    const names = await page.locator('ul[aria-label="Queues"] h2').allTextContents();
    console.log(`PASS ${name}: organization page lists ${names.length} queue(s): ${names.join(', ')}`);
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/visit/'); return r?.scope ?? null; });
    console.log(`  service worker registered on the list page: ${sw ?? 'no (registered only on the token page, as designed)'}`);
  } else {
    await page.getByText(/could not be found|not found/i).waitFor({ timeout: 60000 });
    console.log(`PASS ${name}: portal allowed; unknown code shows not-found`);
  }
}
// Socket.io handshake from a browser origin on Pages to the API
const page = await (await browser.newContext(iphone)).newPage();
await page.goto(`${WEB}/visit/zzzz00000000`);
const sio = await page.evaluate(async () => { const r = await fetch('https://livequeueapp.onrender.com/socket.io/?EIO=4&transport=polling'); return { status: r.status, body: (await r.text()).slice(0, 40) }; });
assert.equal(sio.status, 200); assert.match(sio.body, /"sid"/);
console.log('PASS Socket.io handshake from the Pages origin to the production API succeeds (CORS ok)');
assert.deepEqual(errors, []);
console.log('PASS no page errors');
await browser.close();

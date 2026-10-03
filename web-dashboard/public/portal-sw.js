/* LiveQueue portal service worker (ADR-068).
 *
 * Registered with scope /visit/ by the iPhone/iPad Safari portal. Its only
 * job is Web Push: show every push immediately (Safari revokes push
 * permission from a site that receives a push and shows nothing), and open
 * the right token page when a notification is tapped.
 *
 * Deliberately no fetch handler and no offline cache: a queue position must
 * never be served stale from a cache.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const FALLBACK = {
  title: 'LiveQueue',
  body: 'Your queue has an update. Open LiveQueue to see it.',
  url: '/visit/',
};

/** Only same-origin paths inside the portal are ever opened. */
function safePortalUrl(raw) {
  try {
    const url = new URL(raw, self.location.origin);
    if (url.origin !== self.location.origin || !url.pathname.startsWith('/visit/')) {
      return FALLBACK.url;
    }
    return url.pathname + url.search;
  } catch {
    return FALLBACK.url;
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : FALLBACK.title;
  const body = typeof payload.body === 'string' && payload.body ? payload.body : FALLBACK.body;
  const url = safePortalUrl(typeof payload.url === 'string' ? payload.url : FALLBACK.url);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof payload.tag === 'string' ? payload.tag : undefined,
      icon: '/portal-icon-192.png',
      badge: '/portal-icon-192.png',
      data: { url, tokenId: typeof payload.tokenId === 'string' ? payload.tokenId : null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safePortalUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(target);
            } catch {
              /* navigation may be refused for an uncontrolled client; focus is enough */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

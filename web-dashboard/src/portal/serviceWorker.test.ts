import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-068: public/portal-sw.js, run against a fake ServiceWorkerGlobalScope.
 * Safari revokes push permission if a push shows nothing, so every push must
 * show a notification; taps open only same-origin portal pages.
 */

const source = readFileSync(resolve(import.meta.dirname, '../../public/portal-sw.js'), 'utf8');

function loadWorker() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const windows: { url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> }[] = [];
  const self = {
    location: { origin: 'https://app.example.com' },
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => windows), openWindow, claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, cb: (event: unknown) => void) => {
      listeners[type] = cb;
    },
  };
  new Function('self', source)(self);
  return { listeners, showNotification, openWindow, windows };
}

async function dispatch(listener: (event: unknown) => void, event: Record<string, unknown>) {
  let pending: Promise<unknown> = Promise.resolve();
  listener({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
  await pending;
}

describe('portal service worker', () => {
  let worker: ReturnType<typeof loadWorker>;
  beforeEach(() => {
    worker = loadWorker();
  });

  it('shows every push immediately, with the token page to open', async () => {
    const payload = { title: 'Your turn is coming', body: 'Go to Desk 3.', tag: 't:1', tokenId: 't1', url: '/visit/token/t1' };
    await dispatch(worker.listeners.push!, { data: { json: () => payload } });
    expect(worker.showNotification).toHaveBeenCalledWith('Your turn is coming', expect.objectContaining({
      body: 'Go to Desk 3.',
      tag: 't:1',
      data: { url: '/visit/token/t1', tokenId: 't1' },
    }));
  });

  it('still shows something for an empty or malformed push', async () => {
    await dispatch(worker.listeners.push!, { data: { json: () => { throw new Error('bad'); } } });
    await dispatch(worker.listeners.push!, { data: null });
    expect(worker.showNotification).toHaveBeenCalledTimes(2);
    expect(worker.showNotification).toHaveBeenLastCalledWith('LiveQueue', expect.objectContaining({ data: expect.objectContaining({ url: '/visit/' }) }));
  });

  it('never opens anything outside the portal', async () => {
    for (const url of ['https://evil.example/phish', '/admin', 'javascript:alert(1)']) {
      await dispatch(worker.listeners.push!, { data: { json: () => ({ title: 'x', body: 'y', url }) } });
    }
    for (const call of worker.showNotification.mock.calls as unknown as [string, { data: { url: string } }][]) {
      expect(call[1].data.url).toBe('/visit/');
    }
  });

  it('a tap focuses an open portal window and takes it to the visit, or opens one', async () => {
    const notification = { close: vi.fn(), data: { url: '/visit/token/t1' } };
    await dispatch(worker.listeners.notificationclick!, { notification });
    expect(notification.close).toHaveBeenCalled();
    expect(worker.openWindow).toHaveBeenCalledWith('/visit/token/t1');

    const open = { url: 'https://app.example.com/visit/', focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) };
    worker.windows.push(open);
    await dispatch(worker.listeners.notificationclick!, { notification });
    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith('/visit/token/t1');
  });
});

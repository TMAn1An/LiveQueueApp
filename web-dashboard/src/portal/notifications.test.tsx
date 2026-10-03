import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationsCard } from './NotificationsCard';
import { SERVICE_WORKER_SCOPE, SERVICE_WORKER_URL, pushAvailability, vapidKeyToBytes } from './push';

/**
 * ADR-068: the notification UX and Web Push subscription lifecycle, against
 * fake browser push objects. This proves the portal's side of the contract;
 * real delivery to an iPhone needs a physical device (see the ADR).
 */

const INSTALL = '0b5c2a10-7d3e-4f51-9a62-abcdefabcdef';
const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const requests: { method: string; path: string; body: unknown }[] = [];
let permission: NotificationPermission = 'default';
let existing: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = null;
const subscribe = vi.fn();
const register = vi.fn();

function fakeSubscription() {
  return {
    endpoint: 'https://web.push.apple.com/abc',
    toJSON: () => ({ endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

beforeEach(() => {
  requests.length = 0;
  permission = 'default';
  existing = null;
  subscribe.mockReset().mockImplementation(async () => {
    permission = 'granted';
    existing = fakeSubscription();
    return existing;
  });
  const registration = {
    pushManager: { getSubscription: async () => existing, subscribe },
  };
  register.mockReset().mockResolvedValue(registration);
  vi.stubGlobal('Notification', {
    get permission() {
      return permission;
    },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      requests.push({ method: init.method ?? 'GET', path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname === '/api/public/web-push/config') {
        return new Response(JSON.stringify({ success: true, data: { enabled: true, vapidPublicKey: VAPID } }));
      }
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ success: true, data: {} }));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error test cleanup of the stubbed property
  delete navigator.serviceWorker;
});

describe('push availability', () => {
  it('a Safari tab on iPhone needs the Home Screen; the Home Screen app can subscribe', () => {
    expect(pushAvailability({ isIOS: true, standalone: false })).toBe('needs-home-screen');
    expect(pushAvailability({ isIOS: true, standalone: true })).toBe('available');
  });

  it('decodes the VAPID key to the 65-byte P-256 point', () => {
    const bytes = vapidKeyToBytes(VAPID);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });
});

describe('NotificationsCard', () => {
  it('in a Safari tab explains Add to Home Screen, asks nothing, and carries the installation id in the page address', () => {
    window.history.replaceState(null, '', '/visit/token/t1');
    localStorage.setItem('livequeue.portal.browserInstallationId', INSTALL);
    render(<NotificationsCard tokenId="t1" installationId={INSTALL} availability="needs-home-screen" />);
    const steps = screen.getByRole('list', { name: 'Add to Home Screen steps' });
    expect(steps).toHaveTextContent('tap the Share button');
    expect(steps).toHaveTextContent('Add to Home Screen');
    expect(steps).toHaveTextContent('Open LiveQueue from your Home Screen');
    expect(steps).toHaveTextContent('Enable notifications');
    expect(screen.queryByRole('button', { name: 'Enable notifications' })).not.toBeInTheDocument();
    expect(subscribe).not.toHaveBeenCalled();
    expect(window.location.search).toBe(`?install=${INSTALL}`);
  });

  it('in the Home Screen app registers the service worker but never prompts until tapped', async () => {
    render(<NotificationsCard tokenId="t1" installationId={INSTALL} availability="available" />);
    const button = await screen.findByRole('button', { name: 'Enable notifications' });
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE });
    expect(subscribe).not.toHaveBeenCalled();

    await userEvent.click(button);
    expect(await screen.findByText('Notifications are on for this visit.')).toBeInTheDocument();
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/api/devices/web-push-subscription',
      body: { deviceIdentifier: INSTALL, subscription: { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'p', auth: 'a' } } },
    });
    expect(requests).toContainEqual({
      method: 'PUT',
      path: '/api/tokens/t1/notification-preferences',
      body: { deviceIdentifier: INSTALL, notificationsEnabled: true, reminderMinutes: null },
    });
  });

  it('a refused prompt says where to turn notifications on', async () => {
    subscribe.mockImplementation(async () => {
      permission = 'denied';
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    });
    render(<NotificationsCard tokenId="t1" installationId={INSTALL} availability="available" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    expect(await screen.findByText(/Settings → Notifications → LiveQueue/)).toBeInTheDocument();
  });

  it('already allowed: re-registers the current subscription and opts this visit in, with no prompt', async () => {
    permission = 'granted';
    existing = fakeSubscription();
    render(<NotificationsCard tokenId="t2" installationId={INSTALL} availability="available" />);
    expect(await screen.findByText('Notifications are on for this visit.')).toBeInTheDocument();
    expect(subscribe).not.toHaveBeenCalled();
    expect(requests.some((r) => r.method === 'POST' && r.path === '/api/devices/web-push-subscription')).toBe(true);
    expect(requests.some((r) => r.method === 'PUT' && r.path === '/api/tokens/t2/notification-preferences')).toBe(true);
  });

  it('turning off opts the visit out, deletes the subscription and unsubscribes the browser', async () => {
    permission = 'granted';
    existing = fakeSubscription();
    const sub = existing;
    render(<NotificationsCard tokenId="t1" installationId={INSTALL} availability="available" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off notifications' }));
    expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeInTheDocument();
    expect(requests).toContainEqual({
      method: 'PUT',
      path: '/api/tokens/t1/notification-preferences',
      body: { deviceIdentifier: INSTALL, notificationsEnabled: false, reminderMinutes: null },
    });
    expect(requests).toContainEqual({
      method: 'DELETE',
      path: '/api/devices/web-push-subscription',
      body: { deviceIdentifier: INSTALL, endpoint: 'https://web.push.apple.com/abc' },
    });
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('says notifications are unavailable when the server has no VAPID keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: { enabled: false, vapidPublicKey: null } }))),
    );
    render(<NotificationsCard tokenId="t1" installationId={INSTALL} availability="available" />);
    expect(await screen.findByText(/Notifications are not available right now/)).toBeInTheDocument();
  });
});

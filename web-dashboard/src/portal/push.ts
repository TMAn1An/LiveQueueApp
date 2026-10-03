import { portalApi } from './portalApi';

/**
 * ADR-068: standards-based Web Push for the portal (Push API, Notifications
 * API, Service Worker, VAPID). On iPhone/iPad this works only for a web app
 * added to the Home Screen (iOS/iPadOS 16.4+), and permission may only be
 * asked from a tap — never on page load.
 */

export const SERVICE_WORKER_URL = '/portal-sw.js';
export const SERVICE_WORKER_SCOPE = '/visit/';

export type PushAvailability =
  /** Push API present: notifications can be offered. */
  | 'available'
  /** iPhone/iPad Safari tab: add to the Home Screen first. */
  | 'needs-home-screen'
  /** Nothing to offer (too old, or not supported here). */
  | 'unsupported';

export function pushAvailability(env: { standalone: boolean; isIOS: boolean } = detect()): PushAvailability {
  const supported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window;
  if (supported && (!env.isIOS || env.standalone)) return 'available';
  if (env.isIOS && !env.standalone) return 'needs-home-screen';
  return 'unsupported';
}

function detect() {
  const nav = navigator as Navigator & { standalone?: boolean };
  const isIOS = /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  const standalone =
    nav.standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return { isIOS, standalone };
}

export function permissionState(): NotificationPermission | 'unsupported' {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
}

/** Registers the portal's service worker (no permission prompt). */
export async function registerPortalServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE });
  } catch {
    return null;
  }
}

export function vapidKeyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64Url}${'='.repeat((4 - (base64Url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Must be called straight from the "Enable notifications" tap: subscribing
 * is what shows the permission prompt, and Safari only allows it during a
 * user gesture. Then registers the subscription with the backend for this
 * installation and opts this visit in.
 */
export async function enableNotifications(input: {
  registration: ServiceWorkerRegistration;
  vapidPublicKey: string;
  installationId: string;
  tokenId: string;
}): Promise<'enabled' | 'denied'> {
  let subscription: PushSubscription;
  try {
    subscription =
      (await input.registration.pushManager.getSubscription()) ??
      (await input.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToBytes(input.vapidPublicKey),
      }));
  } catch (err) {
    if (permissionState() === 'denied' || (err as { name?: string })?.name === 'NotAllowedError') return 'denied';
    throw err;
  }
  await portalApi.registerWebPush(input.installationId, subscription.toJSON());
  await portalApi.setNotifications(input.tokenId, input.installationId, true);
  return 'enabled';
}

/** Turns notifications off for this visit and drops the browser subscription. */
export async function disableNotifications(input: {
  registration: ServiceWorkerRegistration;
  installationId: string;
  tokenId: string;
}): Promise<void> {
  await portalApi.setNotifications(input.tokenId, input.installationId, false);
  const subscription = await input.registration.pushManager.getSubscription();
  if (subscription) {
    await portalApi.unregisterWebPush(input.installationId, subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe().catch(() => false);
  }
}

/**
 * Keeps the backend's copy current: browsers may rotate a subscription, so
 * on each visit an existing one is re-registered (no prompt involved).
 */
export async function syncExistingSubscription(
  registration: ServiceWorkerRegistration,
  installationId: string,
): Promise<boolean> {
  if (permissionState() !== 'granted') return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await portalApi.registerWebPush(installationId, subscription.toJSON()).catch(() => undefined);
  return true;
}

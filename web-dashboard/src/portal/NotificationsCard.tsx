import { useEffect, useRef, useState } from 'react';
import { urlCarryingInstallation } from './installation';
import { portalApi } from './portalApi';
import {
  disableNotifications,
  enableNotifications,
  permissionState,
  pushAvailability,
  registerPortalServiceWorker,
  syncExistingSubscription,
  type PushAvailability,
} from './push';
import { Card, Notice, PrimaryButton, SecondaryButton } from './ui';

type CardState = 'checking' | 'off' | 'on' | 'denied' | 'disabled-server' | 'unsupported' | 'needs-home-screen' | 'error';

/**
 * ADR-068: notifications for this visit.
 *
 * Never asks on page load. In a Safari tab on iPhone/iPad it explains the
 * Home Screen step (Web Push only exists for Home Screen web apps); in the
 * Home Screen app it offers one "Enable notifications" button whose tap is
 * the user gesture iOS requires.
 */
export function NotificationsCard({
  tokenId,
  installationId,
  availability = pushAvailability(),
}: {
  tokenId: string;
  installationId: string;
  availability?: PushAvailability;
}) {
  const [state, setState] = useState<CardState>(
    availability === 'available' ? 'checking' : availability === 'needs-home-screen' ? 'needs-home-screen' : 'unsupported',
  );
  const [error, setError] = useState<string | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const vapidKey = useRef<string | null>(null);

  useEffect(() => {
    if (availability === 'needs-home-screen') {
      // The page added to the Home Screen opens there; carrying this
      // browser's installation id lets the Home Screen app keep this visit.
      window.history.replaceState(window.history.state, '', urlCarryingInstallation(window.location));
      return;
    }
    if (availability !== 'available') return;
    let cancelled = false;
    void (async () => {
      const [reg, config] = await Promise.all([
        registerPortalServiceWorker(),
        portalApi.webPushConfig().catch(() => ({ enabled: false, vapidPublicKey: null })),
      ]);
      if (cancelled) return;
      registration.current = reg;
      vapidKey.current = config.vapidPublicKey;
      if (!config.enabled || !config.vapidPublicKey || !reg) {
        setState('disabled-server');
        return;
      }
      if (permissionState() === 'denied') {
        setState('denied');
        return;
      }
      // Already allowed earlier (e.g. for another visit): keep the backend's
      // copy current and opt this visit in too — no prompt involved.
      const subscribed = await syncExistingSubscription(reg, installationId).catch(() => false);
      if (subscribed) {
        await portalApi.setNotifications(tokenId, installationId, true).catch(() => undefined);
      }
      if (!cancelled) setState(subscribed ? 'on' : 'off');
    })();
    return () => {
      cancelled = true;
    };
  }, [availability, installationId, tokenId]);

  async function turnOn() {
    // Runs straight from the tap: subscribe() is what shows iOS's prompt.
    if (!registration.current || !vapidKey.current) return;
    setError(null);
    try {
      const outcome = await enableNotifications({
        registration: registration.current,
        vapidPublicKey: vapidKey.current,
        installationId,
        tokenId,
      });
      setState(outcome === 'enabled' ? 'on' : 'denied');
    } catch {
      setError('Notifications could not be turned on. Please try again.');
      setState('error');
    }
  }

  async function turnOff() {
    if (!registration.current) return;
    await disableNotifications({ registration: registration.current, installationId, tokenId }).catch(() => undefined);
    setState('off');
  }

  return (
    <Card>
      <h2 className="text-base font-semibold">Notifications</h2>
      {state === 'needs-home-screen' && (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-muted">
            This page updates live while it is open. To be notified when it is your turn, add LiveQueue to your Home Screen:
          </p>
          <ol className="list-decimal space-y-1 pl-5" aria-label="Add to Home Screen steps">
            <li>In Safari, tap the Share button.</li>
            <li>Choose “Add to Home Screen”, then “Add”.</li>
            <li>Open LiveQueue from your Home Screen.</li>
            <li>Tap “Enable notifications”.</li>
          </ol>
          <p className="text-xs text-muted">Requires iOS or iPadOS 16.4 or later.</p>
        </div>
      )}
      {state === 'unsupported' && (
        <p className="mt-2 text-sm text-muted">Notifications are not available on this device. Keep this page open to follow your turn.</p>
      )}
      {state === 'checking' && <p className="mt-2 text-sm text-muted">Checking…</p>}
      {state === 'disabled-server' && (
        <p className="mt-2 text-sm text-muted">Notifications are not available right now. Keep this page open to follow your turn.</p>
      )}
      {state === 'denied' && (
        <p className="mt-2 text-sm text-muted">
          Notifications are turned off for LiveQueue. To allow them, open Settings → Notifications → LiveQueue.
        </p>
      )}
      {(state === 'off' || state === 'error') && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted">Get a notification shortly before your turn and when you are called.</p>
          <PrimaryButton onClick={() => void turnOn()}>Enable notifications</PrimaryButton>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
      {state === 'on' && (
        <div className="mt-3 space-y-2">
          <Notice tone="ok">Notifications are on for this visit.</Notice>
          <SecondaryButton onClick={() => void turnOff()}>Turn off notifications</SecondaryButton>
        </div>
      )}
    </Card>
  );
}

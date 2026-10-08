import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getApiBaseUrl } from '../api/client';
import { portalApi, type PortalToken } from './portalApi';

/**
 * ADR-068: live token tracking while the portal is open.
 *
 * Uses the existing public Socket.io token room (no account; the token id is
 * the capability, exactly as for the Android app).
 *
 * ADR-075: like the Android app, the portal now uses what the event already
 * carries instead of re-reading the token after every event. Each REST read
 * of a token re-runs the whole queue's ETA simulation on the server, and
 * every queue change sends one event to every waiting person, so N portal
 * visitors used to cost N simulations per queue change.
 *
 * - Lifecycle events (called, started, step completed, completed, skipped,
 *   cancelled — including a queue deletion) carry the full customer view,
 *   built by the same backend function as the REST read: it replaces the
 *   screen's state as is.
 * - `token.position_changed` carries the new position, wait and ETA reason:
 *   only those fields are patched.
 * - Anything that cannot be applied safely (an unexpected payload, a
 *   position update for a token not shown as waiting, a queue event) asks
 *   for one real read, coalesced over a short window.
 *
 * The backend stays the source of truth: every (re)connect and every return
 * to the page re-reads the token, and a slow safety read (every ~10 minutes
 * while the visit is live and the page visible) means no client-side state
 * can outlive a silently lost event indefinitely.
 */

export type LiveState = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** Their payload is the full customer view of this token. */
const LIFECYCLE_EVENTS = [
  'token.called',
  'token.started',
  'token.step_completed',
  'token.completed',
  'token.skipped',
  'token.cancelled',
] as const;
const POSITION_EVENT = 'token.position_changed';
/** Never sent to a token room today; if one arrives, re-read rather than guess. */
const RELOAD_EVENTS = ['token.created', 'queue.status_changed', 'queue.updated'] as const;

export const TERMINAL_STATUSES = new Set(['COMPLETED', 'SKIPPED', 'CANCELLED']);

/** Coalesces reads requested in a burst into one. */
export const RELOAD_DEBOUNCE_MS = 250;
/** The safety read's period; each visitor's is jittered ±20% so they spread out. */
export const RECONCILE_MS = 10 * 60 * 1000;

interface Envelope {
  tokenId?: string;
  data?: unknown;
}

function isCustomerView(data: unknown, tokenId: string): data is PortalToken {
  if (!data || typeof data !== 'object') return false;
  const view = data as Partial<PortalToken>;
  return (
    view.id === tokenId &&
    typeof view.status === 'string' &&
    typeof view.serialNumber === 'string' &&
    Array.isArray(view.services) &&
    'position' in view
  );
}

interface PositionUpdate {
  position: number | null;
  estimatedWaitMinutes: number | null;
  etaUnavailableReason?: string | null;
}

function isPositionUpdate(data: unknown): data is PositionUpdate {
  if (!data || typeof data !== 'object') return false;
  const update = data as Partial<PositionUpdate>;
  return 'position' in update && 'estimatedWaitMinutes' in update;
}

export function useLiveToken(tokenId: string) {
  const [token, setToken] = useState<PortalToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState>('connecting');
  const socketRef = useRef<Socket | null>(null);
  // Every read and every applied event takes a ticket; only the newest wins,
  // so a slow earlier read never overwrites something more recent.
  const latest = useRef(0);
  const inFlight = useRef(0);
  const current = useRef<PortalToken | null>(null);
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: PortalToken) => {
    current.current = next;
    setToken(next);
  }, []);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    inFlight.current += 1;
    try {
      const fresh = await portalApi.token(tokenId);
      if (ticket === latest.current) {
        show(fresh);
        setError(null);
      }
    } catch (err) {
      if (ticket === latest.current) setError((err as Error).message);
    } finally {
      inFlight.current -= 1;
    }
  }, [tokenId, show]);

  useEffect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function scheduleReload() {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void refresh();
      }, RELOAD_DEBOUNCE_MS);
    }

    function armReconcile() {
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
      if (disposed) return;
      const jitter = 0.8 + Math.random() * 0.4;
      reconcileTimer.current = setTimeout(() => {
        const shown = current.current;
        const ended = shown !== null && TERMINAL_STATUSES.has(shown.status);
        if (!ended && document.visibilityState === 'visible') void refresh();
        armReconcile();
      }, RECONCILE_MS * jitter);
    }

    // Applying an event outdates any read still in flight (it may have been
    // answered before the event). A full view replaces it outright; after a
    // partial patch, one more read is asked for so nothing is lost.
    function supersedeReads(): boolean {
      const hadRead = inFlight.current > 0;
      latest.current += 1;
      return hadRead;
    }

    function onLifecycle(envelope: Envelope) {
      if (envelope?.tokenId && envelope.tokenId !== tokenId) return;
      if (isCustomerView(envelope?.data, tokenId)) {
        supersedeReads();
        show(envelope.data);
        setError(null);
      } else {
        scheduleReload();
      }
    }

    function onPosition(envelope: Envelope) {
      if (envelope?.tokenId && envelope.tokenId !== tokenId) return;
      const shown = current.current;
      const update = envelope?.data;
      if (!shown || shown.status !== 'WAITING' || !isPositionUpdate(update)) {
        // Either nothing is shown yet or the screen and the server disagree
        // about whether this person is waiting: re-read instead of patching.
        scheduleReload();
        return;
      }
      if (supersedeReads()) scheduleReload();
      show({
        ...shown,
        position: update.position,
        estimatedWaitMinutes: update.estimatedWaitMinutes,
        etaUnavailableReason:
          update.etaUnavailableReason === undefined ? shown.etaUnavailableReason : update.etaUnavailableReason,
      });
    }

    // First read straight away (not waiting for the socket).
    const initial = setTimeout(() => void refresh(), 0);
    const socket = io(getApiBaseUrl(), { autoConnect: false, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const join = () => {
      socket.emit('join:token', { tokenId }, () => undefined);
      setLive('live');
      // A reconnect may have missed events: re-read the truth.
      void refresh();
    };
    socket.on('connect', join);
    socket.on('disconnect', () => setLive('reconnecting'));
    // The manager is shared by every socket to this origin, so this handler
    // is removed by name on cleanup rather than with removeAllListeners.
    const onReconnectFailed = () => setLive('offline');
    socket.io.on('reconnect_failed', onReconnectFailed);
    for (const event of LIFECYCLE_EVENTS) socket.on(event, onLifecycle);
    socket.on(POSITION_EVENT, onPosition);
    for (const event of RELOAD_EVENTS) socket.on(event, scheduleReload);
    socket.connect();
    armReconcile();

    // Returning to the page (unlocking the phone, switching back to Safari)
    // also re-reads: iOS suspends background pages and their sockets.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        if (!socket.connected) socket.connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      clearTimeout(initial);
      if (reloadTimer) clearTimeout(reloadTimer);
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
      document.removeEventListener('visibilitychange', onVisible);
      socket.removeAllListeners();
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [tokenId, refresh, show]);

  return { token, error, live, refresh };
}

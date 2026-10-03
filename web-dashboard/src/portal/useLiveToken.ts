import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getApiBaseUrl } from '../api/client';
import { portalApi, type PortalToken } from './portalApi';

/**
 * ADR-068: live token tracking while the portal is open.
 *
 * Uses the existing public Socket.io token room (no account; the token id is
 * the capability, exactly as for the Android app). Socket events are only a
 * prompt: every event — and every (re)connect — re-reads the token over REST,
 * so the screen always shows the backend's state, never a stale or partial
 * client-side guess.
 */

export type LiveState = 'connecting' | 'live' | 'reconnecting' | 'offline';

const TOKEN_EVENTS = [
  'token.created',
  'token.called',
  'token.started',
  'token.completed',
  'token.skipped',
  'token.cancelled',
  'token.position_changed',
  'queue.status_changed',
  'queue.updated',
] as const;

export const TERMINAL_STATUSES = new Set(['COMPLETED', 'SKIPPED', 'CANCELLED']);

export function useLiveToken(tokenId: string) {
  const [token, setToken] = useState<PortalToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState>('connecting');
  const socketRef = useRef<Socket | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const fresh = await portalApi.token(tokenId);
      // Only the newest answer wins, so a slow earlier read never overwrites a later one.
      if (ticket === latest.current) {
        setToken(fresh);
        setError(null);
      }
    } catch (err) {
      if (ticket === latest.current) setError((err as Error).message);
    }
  }, [tokenId]);

  useEffect(() => {
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
    socket.io.on('reconnect_failed', () => setLive('offline'));
    for (const event of TOKEN_EVENTS) socket.on(event, () => void refresh());
    socket.connect();

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
      clearTimeout(initial);
      document.removeEventListener('visibilitychange', onVisible);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [tokenId, refresh]);

  return { token, error, live, refresh };
}

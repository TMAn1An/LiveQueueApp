import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../services/socket.service';
import { myCounterQuery } from '../hooks/useCounters';

export type ConsoleConnection = 'live' | 'reconnecting' | 'checking';

/**
 * ADR-072: the console's view of the dashboard's one Socket.io connection
 * (shared, never a second one).
 *
 * - `live`: connected; server events keep the console current.
 * - `reconnecting`: the connection dropped and Socket.io is retrying. Actions
 *   are held until it is back, so nothing is done against a stale view.
 * - `checking`: the server closed the connection itself — what it does the
 *   moment someone's access changes (ADR-071). The console re-asks the
 *   backend at once; a revoked session answers 401 and the dashboard signs
 *   out (which closes the console). If the session is still good, the
 *   connection is reopened.
 */
export function useConsoleConnection(): ConsoleConnection {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConsoleConnection>(() => (getSocket().connected ? 'live' : 'reconnecting'));

  useEffect(() => {
    const socket = getSocket();
    let cancelled = false;

    const onConnect = () => setState('live');
    const onDisconnect = (reason: string) => {
      if (reason !== 'io server disconnect') {
        setState('reconnecting');
        return;
      }
      setState('checking');
      void queryClient
        .fetchQuery({ ...myCounterQuery, staleTime: 0 })
        .then(() => {
          if (!cancelled && !socket.connected) socket.connect();
        })
        .catch(() => {
          // A 401 has already signed the session out; anything else (offline)
          // leaves the console in `checking`, actions held, until the
          // dashboard recovers.
        });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [queryClient]);

  return state;
}

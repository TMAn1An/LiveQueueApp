import http from 'node:http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { attachSocketServer, resetIOForTests } from '../../src/realtime/socketServer';

/**
 * A bare (Express-less) HTTP server purely to host Socket.io. REST calls in
 * realtime tests still go through the existing `api()` helper (tests/helpers/app.ts),
 * which uses supertest against the shared Express `app` object directly —
 * that's a *different* listening socket than this one, but it doesn't
 * matter: attachSocketServer() sets a process-wide module singleton (getIO()),
 * so controller code triggered via supertest's ephemeral listener still
 * finds and uses the exact same `io` instance real socket.io-client
 * connections here are attached to.
 */
let sharedServer: http.Server | undefined;
let sharedPort: number | undefined;

export async function ensureSocketTestServer(): Promise<number> {
  if (sharedServer && sharedPort) {
    return sharedPort;
  }

  sharedServer = http.createServer();
  attachSocketServer(sharedServer);

  await new Promise<void>((resolve) => {
    sharedServer!.listen(0, resolve);
  });

  const address = sharedServer.address();
  sharedPort = typeof address === 'object' && address ? address.port : 0;
  return sharedPort;
}

export async function closeSocketTestServer(): Promise<void> {
  if (!sharedServer) return;
  await new Promise<void>((resolve, reject) => {
    sharedServer!.close((err) => (err ? reject(err) : resolve()));
  });
  sharedServer = undefined;
  sharedPort = undefined;
  resetIOForTests();
}

export function connectClient(port: number, token?: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${port}`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
}

export function waitForConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err: Error) => reject(err));
  });
}

export function waitForConnectError(socket: ClientSocket): Promise<Error> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('Expected connect_error but got connect')));
    socket.once('connect_error', (err: Error) => resolve(err));
  });
}

export function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for event "${event}"`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Collects every occurrence of `event` received during `windowMs`, then resolves. */
export function collectEvents<T = unknown>(
  socket: ClientSocket,
  event: string,
  windowMs = 500,
): Promise<T[]> {
  return new Promise((resolve) => {
    const received: T[] = [];
    const handler = (payload: T) => received.push(payload);
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve(received);
    }, windowMs);
  });
}

export interface JoinAck {
  success: boolean;
  error?: { code: string; message: string };
}

export function joinOrganization(socket: ClientSocket, organizationId: string): Promise<JoinAck> {
  return new Promise((resolve) => {
    socket.emit('join:organization', { organizationId }, resolve);
  });
}

export function joinQueue(socket: ClientSocket, queueId: string): Promise<JoinAck> {
  return new Promise((resolve) => {
    socket.emit('join:queue', { queueId }, resolve);
  });
}

export function joinToken(socket: ClientSocket, tokenId: string): Promise<JoinAck> {
  return new Promise((resolve) => {
    socket.emit('join:token', { tokenId }, resolve);
  });
}

import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { corsOrigins } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import {
  legacyWorkspaceRoom,
  organizationRoom,
  queueRoom,
  staffQueueRoom,
  tokenRoom,
  workspaceRoom,
} from './rooms';
import { socketAuthMiddleware, type AppSocket } from './socketAuth';
import type {
  AppSocketData,
  ClientToServerEvents,
  InterServerEvents,
  JoinAck,
  ServerToClientEvents,
} from './types';

export type AppServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData
>;

/**
 * Module-level singleton, set once per process by attachSocketServer(). Most
 * existing (Phase 1-3) tests never call attachSocketServer, so getIO()
 * returns null for them — the emit layer treats that as a safe no-op, never
 * a failure (approved Phase 4 decision 6 / 8: no Redis, no cross-instance
 * state, single-instance only).
 */
let ioInstance: AppServer | null = null;

export function getIO(): AppServer | null {
  return ioInstance;
}

/** Test-only escape hatch to force a clean singleton between server instances in the same test file. */
export function resetIOForTests(): void {
  ioInstance = null;
}

function respond(ack: ((res: JoinAck) => void) | undefined, res: JoinAck): void {
  if (typeof ack === 'function') {
    ack(res);
  }
}

export function attachSocketServer(httpServer: HttpServer): AppServer {
  const io: AppServer = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigins.length > 0 ? corsOrigins : false,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    socketAuthMiddleware(socket as AppSocket, next).catch(next);
  });

  io.on('connection', (socket: AppSocket) => {
    logger.info(
      { socketId: socket.id, authenticated: Boolean(socket.data.auth) },
      'Socket connected',
    );

    // Organization room: staff-only. The requested organizationId is only
    // ever compared against the socket's own DB-authoritative auth context,
    // never trusted or substituted from the client (approved decision 2/3).
    socket.on('join:organization', (payload, ack) => {
      const auth = socket.data.auth;
      if (!auth) {
        respond(ack, {
          success: false,
          error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' },
        });
        return;
      }
      if (!payload?.organizationId || payload.organizationId !== auth.organizationId) {
        respond(ack, {
          success: false,
          error: { code: 'FORBIDDEN', message: 'You may only join your own organization room.' },
        });
        return;
      }
      // ADR-069: which staff rooms this person may hear is decided here from
      // their DB-authoritative role and workspace, never from the request.
      void (async () => {
        for (const room of await staffRoomsFor(auth)) socket.join(room);
        respond(ack, { success: true });
      })();
    });

    // Queue room: public, customer-facing (ADR-007). Only membership is
    // gated by the queue actually existing — no auth required.
    socket.on('join:queue', (payload, ack) => {
      void (async () => {
        const queueId = payload?.queueId;
        if (!queueId) {
          respond(ack, {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'queueId is required.' },
          });
          return;
        }
        const queue = await prisma.queue.findUnique({ where: { id: queueId } });
        if (!queue) {
          respond(ack, {
            success: false,
            error: { code: 'QUEUE_NOT_FOUND', message: 'Queue not found.' },
          });
          return;
        }
        socket.join(queueRoom(queueId));
        respond(ack, { success: true });
      })();
    });

    // Token room: public by UUID possession, matching the Phase 3 REST
    // trust model (approved decision 2) — no auth required.
    socket.on('join:token', (payload, ack) => {
      void (async () => {
        const tokenId = payload?.tokenId;
        if (!tokenId) {
          respond(ack, {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'tokenId is required.' },
          });
          return;
        }
        const token = await prisma.token.findUnique({ where: { id: tokenId } });
        if (!token) {
          respond(ack, {
            success: false,
            error: { code: 'TOKEN_NOT_FOUND', message: 'Token not found.' },
          });
          return;
        }
        socket.join(tokenRoom(tokenId));
        respond(ack, { success: true });
      })();
    });

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'Socket disconnected');
    });
  });

  ioInstance = io;
  return io;
}

/** ADR-069: the staff rooms a signed-in person belongs to. */
async function staffRoomsFor(auth: {
  staffId: string;
  organizationId: string;
  role: string;
  workspaceAdminId?: string | null;
}): Promise<string[]> {
  const rooms: string[] = [];
  if (auth.role === 'OWNER' || auth.role === 'MANAGER') {
    rooms.push(organizationRoom(auth.organizationId));
  } else if (auth.role === 'ADMIN') {
    rooms.push(workspaceRoom(auth.staffId));
  } else if (auth.workspaceAdminId) {
    rooms.push(workspaceRoom(auth.workspaceAdminId));
  } else {
    rooms.push(legacyWorkspaceRoom(auth.organizationId));
  }
  const counter = await prisma.counter.findUnique({
    where: { staffId: auth.staffId },
    select: { queueId: true },
  });
  if (counter) rooms.push(staffQueueRoom(counter.queueId));
  return rooms;
}

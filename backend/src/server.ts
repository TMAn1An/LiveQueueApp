import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';
import { attachSocketServer } from './realtime/socketServer';
import { reportEmailConfiguration } from './services/email.service';
import { startReminderScheduler, stopReminderScheduler } from './scheduler/reminderScheduler';
import {
  startPendingRegistrationCleanupScheduler,
  stopPendingRegistrationCleanupScheduler,
} from './scheduler/pendingRegistrationCleanupScheduler';

const app = createApp();
const server = http.createServer(app);
attachSocketServer(server);

server.listen(env.PORT, () => {
  logger.info(`LiveQueue backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  // Surfaced at boot, not at the first failed signup — see the function's
  // own doc comment for why this warns rather than exits.
  reportEmailConfiguration();
  startReminderScheduler();
  startPendingRegistrationCleanupScheduler();
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  await stopReminderScheduler();
  await stopPendingRegistrationCleanupScheduler();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

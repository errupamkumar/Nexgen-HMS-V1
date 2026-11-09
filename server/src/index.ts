import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './core/logger.js';
import { pool } from './db/client.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`NexGen HMS API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

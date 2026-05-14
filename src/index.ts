import 'dotenv/config';
import { createApp } from './app.js';
import { startAuditConsumer, stopAuditConsumer } from './kafka/consumer.js';
import { prisma } from './adapters/db/prisma/client.js';
import { logger } from './observability/logger.js';
import { env } from './config/env.js';

async function main() {
  // Start HTTP server
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'audit-hub HTTP server started');
    logger.info('Endpoints: GET /health/live, GET /health/ready, GET /metrics, GET /api/audit/activity, GET /api/audit/activity/me');
  });

  // Start Kafka consumer
  await startAuditConsumer();

  // Graceful shutdown
  async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutdown signal received');
    server.close();
    await stopAuditConsumer();
    await prisma.$disconnect();
    logger.info('Graceful shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'audit-hub failed to start');
  process.exit(1);
});

import { PrismaClient } from '@prisma/client';
import { logger } from '../../../observability/logger.js';

export const prisma = new PrismaClient({
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn',  emit: 'event' },
  ],
});

prisma.$on('error', (e) => logger.error({ err: e }, 'Prisma error'));
prisma.$on('warn',  (e) => logger.warn({ msg: e.message }, 'Prisma warning'));

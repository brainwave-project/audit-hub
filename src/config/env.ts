import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT:           z.coerce.number().default(3003),
  NODE_ENV:       z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL:   z.string().min(1, 'DATABASE_URL is required'),
  KAFKA_BROKERS:  z.string().default('kafka:9092'),
  KAFKA_GROUP_ID: z.string().default('brainwave.audit-hub'),
  LOG_LEVEL:      z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[audit-hub] Invalid environment:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

export type Env = typeof env;

import { createLogger, type Logger } from '@brainwave-project/core';
import { env } from '../config/env.js';

/**
 * Service-scoped Pino logger. Uses core's createLogger so every log line
 * automatically includes traceId + spanId when an OTel span is active
 * (via the pino mixin in core).
 */
export const logger: Logger = createLogger({
  serviceName: 'audit-hub',
  level:       env.LOG_LEVEL,
});

export type { Logger };

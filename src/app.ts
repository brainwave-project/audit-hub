import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './observability/logger.js';
import { metricsMiddleware, getMetrics, register } from './observability/metrics.js';
import { createAuditRouter } from './transport/http/router.js';
import { setupSwagger } from './config/swagger.js';
import { livenessHandler } from './health/liveness.js';
import { readinessHandler } from './health/readiness.js';

// Fallback: extract X-User-Id from JWT if Kong didn't inject it (Swagger / direct access)
function injectUserId(req: Request, _res: Response, next: NextFunction): void {
  if (req.headers['x-user-id']) return next();
  const auth = req.headers['authorization'];
  if (!auth) return next();
  const token = auth.replace(/^[Bb]earer\s+/, '');
  const parts = token.split('.');
  if (parts.length !== 3) return next();
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    if (payload.sub) req.headers['x-user-id'] = payload.sub;
  } catch { /* ignore */ }
  next();
}

// Generic error handler
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(metricsMiddleware);
  app.use(injectUserId);

  // Health probes
  app.get('/health/live',  livenessHandler);
  app.get('/health/ready', (req, res) => readinessHandler(req, res));

  // Prometheus scrape
  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.send(await getMetrics());
    } catch (err) {
      res.status(500).send(String(err));
    }
  });

  // Audit API — JWT validated at Kong, X-User-Id injected
  app.use('/api/audit', createAuditRouter());

  // Swagger UI
  setupSwagger(app);

  app.use(errorHandler);

  return app;
}

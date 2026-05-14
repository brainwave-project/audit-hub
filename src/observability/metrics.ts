import {
  Registry,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

export const register = new Registry();
register.setDefaultLabels({ service: 'audit-hub' });
collectDefaultMetrics({ register });

// HTTP RED metrics
export const httpRequestsTotal = new Counter({
  name:       'audithub_http_requests_total',
  help:       'Total HTTP requests received by audit-hub',
  labelNames: ['method', 'route', 'status_code'],
  registers:  [register],
});

export const httpRequestDuration = new Histogram({
  name:       'audithub_http_request_duration_seconds',
  help:       'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets:    [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers:  [register],
});

// Kafka consumer metrics
export const kafkaEventsConsumed = new Counter({
  name:       'audithub_kafka_events_consumed_total',
  help:       'Total domain events consumed from Kafka',
  labelNames: ['topic', 'action', 'outcome'],
  registers:  [register],
});

export const kafkaEventsErrored = new Counter({
  name:       'audithub_kafka_events_errored_total',
  help:       'Domain events that failed to be persisted',
  labelNames: ['topic'],
  registers:  [register],
});

export function getMetrics(): Promise<string> {
  return register.metrics();
}

import type { Request, Response, NextFunction } from 'express';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const route  = req.route?.path ?? req.path ?? 'unknown';
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, (Date.now() - start) / 1000);
  });
  next();
}

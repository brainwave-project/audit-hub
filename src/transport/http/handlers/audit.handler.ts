/**
 * Audit-hub REST handlers.
 *
 * Two endpoints:
 *   GET /api/audit/activity/me   — current user's own activity (scoped to X-User-Id)
 *   GET /api/audit/activity      — all activity (admin view, paginated + filtered)
 *
 * Both are read-only (GET). Pagination follows the same pattern as all Brainwave services:
 *   ?limit=20&offset=0
 *
 * Filtering:
 *   action     — exact AuditAction value (e.g. DOCUMENT_UPLOADED)
 *   service    — auth-hub | user-hub | know-hub
 *   outcome    — SUCCESS | FAILURE
 *   from / to  — ISO 8601 date range on occurredAt
 *   userId     — (admin only) filter by actorId
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../adapters/db/prisma/client.js';

// ---------------------------------------------------------------------------
// Shared query schema
// ---------------------------------------------------------------------------

const PaginationSchema = z.object({
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  offset:  z.coerce.number().int().min(0).default(0),
  action:  z.string().optional(),
  service: z.string().optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE']).optional(),
  from:    z.string().datetime({ offset: true }).optional(),
  to:      z.string().datetime({ offset: true }).optional(),
});

const AdminQuerySchema = PaginationSchema.extend({
  userId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId(req: Request): string {
  const id = req.headers['x-user-id'] as string | undefined;
  if (!id) throw new Error('X-User-Id header missing');
  return id;
}

function buildWhereClause(
  parsed: z.infer<typeof AdminQuerySchema>,
  actorIdOverride?: string,
) {
  return {
    ...(actorIdOverride
      ? { actorId: actorIdOverride }
      : parsed.userId ? { actorId: parsed.userId } : {}),
    ...(parsed.action  ? { action:  parsed.action  } : {}),
    ...(parsed.service ? { service: parsed.service } : {}),
    ...(parsed.outcome ? { outcome: parsed.outcome } : {}),
    ...(parsed.from || parsed.to
      ? {
          occurredAt: {
            ...(parsed.from ? { gte: new Date(parsed.from) } : {}),
            ...(parsed.to   ? { lte: new Date(parsed.to)   } : {}),
          },
        }
      : {}),
  };
}

function mapEvent(e: {
  id: string;
  eventId: string;
  occurredAt: Date;
  actorId: string;
  actorEmail: string | null;
  actorRoles: string[];
  action: string;
  service: string;
  resourceType: string | null;
  resourceId: string | null;
  resourceName: string | null;
  outcome: string;
  correlationId: string | null;
  metadata: unknown;
  createdAt: Date;
}) {
  return {
    id:           e.id,
    eventId:      e.eventId,
    occurredAt:   e.occurredAt.toISOString(),
    actor: {
      userId: e.actorId,
      email:  e.actorEmail,
      roles:  e.actorRoles,
    },
    action:  e.action,
    service: e.service,
    resource: e.resourceId
      ? { type: e.resourceType, id: e.resourceId, name: e.resourceName }
      : null,
    outcome:       e.outcome,
    correlationId: e.correlationId,
    metadata:      e.metadata,
  };
}

// ---------------------------------------------------------------------------
// Handler: GET /api/audit/activity/me
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/audit/activity/me:
 *   get:
 *     summary: List the current user's own audit activity (paginated)
 *     tags: [Audit]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *         description: Filter by action (e.g. DOCUMENT_UPLOADED)
 *       - in: query
 *         name: service
 *         schema: { type: string, enum: [auth-hub, user-hub, know-hub] }
 *       - in: query
 *         name: outcome
 *         schema: { type: string, enum: [SUCCESS, FAILURE] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Paginated activity list for the signed-in user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:  { type: array }
 *                 total:  { type: integer }
 *                 limit:  { type: integer }
 *                 offset: { type: integer }
 */
export async function myActivityHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actorId = getUserId(req);
    const parsed  = PaginationSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({ error: 'Invalid query', issues: parsed.error.issues });
      return;
    }

    const where = buildWhereClause(parsed.data, actorId);
    const [items, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take:   parsed.data.limit,
        skip:   parsed.data.offset,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    res.status(200).json({
      items:  items.map(mapEvent),
      total,
      limit:  parsed.data.limit,
      offset: parsed.data.offset,
    });
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------------------
// Handler: GET /api/audit/activity
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/audit/activity:
 *   get:
 *     summary: List all audit activity across users — admin view (paginated + filtered)
 *     tags: [Audit]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0, minimum: 0 }
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *         description: Filter by actor's Keycloak sub
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: service
 *         schema: { type: string, enum: [auth-hub, user-hub, know-hub] }
 *       - in: query
 *         name: outcome
 *         schema: { type: string, enum: [SUCCESS, FAILURE] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Paginated audit log
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:  { type: array }
 *                 total:  { type: integer }
 *                 limit:  { type: integer }
 *                 offset: { type: integer }
 */
export async function allActivityHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = AdminQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({ error: 'Invalid query', issues: parsed.error.issues });
      return;
    }

    const where = buildWhereClause(parsed.data);
    const [items, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take:   parsed.data.limit,
        skip:   parsed.data.offset,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    res.status(200).json({
      items:  items.map(mapEvent),
      total,
      limit:  parsed.data.limit,
      offset: parsed.data.offset,
    });
  } catch (err) { next(err); }
}

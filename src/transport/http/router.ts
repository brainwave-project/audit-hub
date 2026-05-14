import { Router } from 'express';
import { myActivityHandler, allActivityHandler } from './handlers/audit.handler.js';

export function createAuditRouter(): Router {
  const router = Router();

  // Current user's own activity — must be before /activity to prevent path conflict
  router.get('/activity/me', myActivityHandler);

  // Admin view — all users
  router.get('/activity', allActivityHandler);

  return router;
}

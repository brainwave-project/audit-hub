import type { Request, Response } from 'express';
import { prisma } from '../adapters/db/prisma/client.js';

export async function readinessHandler(_req: Request, res: Response): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ready', checks: { postgres: 'ok' } });
  } catch (err) {
    res.status(503).json({ status: 'not ready', checks: { postgres: 'fail' }, error: String(err) });
  }
}

import type { Request, Response } from 'express';

export function livenessHandler(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', service: 'audit-hub' });
}

import { Logger } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Bearer gate for every /api route.
 *
 * With no token configured the middleware lets everything through, which keeps the
 * local development default unchanged. /api/health is always open so monitoring and
 * container probes keep working while the rest of the API is locked down.
 */
export function createApiAuthMiddleware(apiToken: string) {
  const logger = new Logger('Auth');

  if (!apiToken) {
    logger.warn('API_TOKEN is not set - the API accepts unauthenticated writes');
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/health') {
      next();
      return;
    }

    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (provided && tokensMatch(provided, apiToken)) {
      next();
      return;
    }

    // Rejections bypass GlobalHttpExceptionFilter, so this is the only trace of them.
    logger.warn(`rejected ${req.method} ${req.originalUrl}`);

    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid bearer token',
      requestId: req.requestId ?? null,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
  };
}

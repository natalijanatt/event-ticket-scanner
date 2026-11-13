import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppConfig } from '../config/app-config';

export const CSRF_HEADER = 'x-csrf-protection';

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 *  1. cookies are SameSite (Lax/Strict),
 *  2. every unsafe request must carry a custom header – a cross-site form or
 *     simple request cannot add one, and a cross-origin fetch that tries is
 *     stopped by the restrictive CORS preflight,
 *  3. when the browser sends `Origin`, it must be an allowed origin.
 * Signed provider webhooks are exempt (they are authenticated by signature).
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(private readonly config: AppConfig) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    if (req.path.startsWith('/api/webhooks/') || req.originalUrl.startsWith('/api/webhooks/')) return next();

    const origin = req.headers.origin;
    const originOk = !origin || this.config.webOrigins.includes(origin.replace(/\/+$/, '')) || this.isSameHost(origin, req);
    if (!originOk || !req.headers[CSRF_HEADER]) {
      res.status(403).json({ statusCode: 403, code: 'CSRF_REJECTED', message: 'Zahtev je odbijen iz bezbednosnih razloga.' });
      return;
    }
    next();
  }

  private isSameHost(origin: string, req: Request): boolean {
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
}

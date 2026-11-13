import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { CSRF_HEADER } from './common/csrf.middleware';
import { AppConfig } from './config/app-config';

/** HTTP-level configuration shared by the real server and the integration tests. */
export function setupApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);

  app.setGlobalPrefix('api');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Cover images are embedded by e-mail clients on other origins.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'", 'blob:'],
          workerSrc: ["'self'", 'blob:'],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
        },
      },
    }),
  );
  app.use(cookieParser());

  // Only the configured web origins may call the API with credentials.
  app.enableCors({
    origin: config.webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', CSRF_HEADER],
    maxAge: 600,
  });

  const uploads = resolve(process.cwd(), config.uploadDir);
  if (!existsSync(uploads)) mkdirSync(uploads, { recursive: true });
  app.useStaticAssets(uploads, { prefix: '/uploads', maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' });

  // Optional single-origin deployment: the API also serves the built web app.
  if (config.webDistDir) {
    const dist = resolve(process.cwd(), config.webDistDir);
    if (existsSync(join(dist, 'index.html'))) {
      app.useStaticAssets(dist, { index: false });
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
        // Ticket pages must never be cached or leak their URL.
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        res.sendFile(join(dist, 'index.html'));
      });
    }
  }

  app.enableShutdownHooks();
}

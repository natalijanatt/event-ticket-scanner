import './config/load-env';
import 'reflect-metadata';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const production = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Raw body is required to verify webhook signatures.
    rawBody: true,
    // Structured JSON logs in production, readable logs in development.
    logger: new ConsoleLogger({ json: production, logLevels: production ? ['log', 'warn', 'error'] : undefined }),
  });
  setupApp(app);

  const config = app.get(AppConfig);
  await app.listen(config.port);
  const logger = new Logger('Bootstrap');
  logger.log(`API listening on port ${config.port} (${config.nodeEnv})`);
  logger.log(`E-mail mode: ${config.emailMode} · queue: ${config.emailQueueMode} · database schema: ${config.dbSchema}`);
}

bootstrap().catch((err) => {
  // Configuration errors must be loud and fatal.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

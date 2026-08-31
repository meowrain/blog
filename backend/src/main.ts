import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AppLogger } from './common/app-logger';
import { HTTP } from './common/constants';
import { createApiAuthMiddleware } from './common/api-auth.middleware';
import { GlobalHttpExceptionFilter } from './common/http-exception.filter';
import { runInRequestContext, sanitizeRequestId } from './common/request-context';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Disabled so the parsers registered below are the only ones in the stack and
  // actually control the body size ceiling (Nest's default would cap it at 100kb).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Every Logger instance resolves through this funnel, which is what lets the
  // requestId below reach lines logged deep inside a service.
  app.useLogger(new AppLogger());

  app.enableCors(HTTP.CORS_CONFIG);
  app.setGlobalPrefix('api');

  // Express runs middleware in registration order and useBodyParser registers
  // immediately, so these must come first: otherwise a rejected or oversized request
  // never reaches the id middleware and its error is logged without one.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = sanitizeRequestId(req.headers['x-request-id']) ?? randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    runInRequestContext({ requestId }, () => next());
  });

  app.use(createApiAuthMiddleware(HTTP.API_TOKEN));

  app.useBodyParser('json', { limit: HTTP.MAX_BODY_SIZE });
  app.useBodyParser('urlencoded', { limit: HTTP.MAX_BODY_SIZE, extended: true });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  // Without this, OnModuleDestroy never runs on SIGTERM/SIGINT and the process is
  // simply killed with the watcher and the prune timer still attached.
  app.enableShutdownHooks();

  await app.listen(HTTP.PORT);
  logger.log(`listening on http://localhost:${HTTP.PORT}`);
  logger.log(`postsDir=${process.env.POSTS_DIR ?? 'default'}`);
  logger.log(`backupsDir=${process.env.BACKUPS_DIR ?? 'default'}`);
}
bootstrap();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { CORS_CONFIG } from './common/constants';
import { randomUUID } from 'crypto';
import { GlobalHttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for Astro dev server
  app.enableCors(CORS_CONFIG);

  // Set global prefix for API routes
  app.setGlobalPrefix('api');

  // Enable validation pipe for DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use((req: any, res: any, next: () => void) => {
    const requestId = req.headers['x-request-id'] || randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  const port = process.env.PORT ?? 3009;
  await app.listen(port);
  console.log(`[bootstrap] listening on http://localhost:${port}`);
  console.log(`[bootstrap] postsDir=${process.env.POSTS_DIR ?? 'default'}`);
}
bootstrap();

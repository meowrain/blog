import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { CORS_CONFIG } from './common/constants';

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

  await app.listen(process.env.PORT ?? 3009);
}
bootstrap();

import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { DatabaseExceptionFilter } from './common/filters/database-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  // File bytes for PUT /api/uploads/:id/content (limit slightly above UPLOAD_MAX_MB; exact size checked in the service).
  const rawLimit = `${Number(process.env.UPLOAD_MAX_MB ?? 10) + 1}mb`;
  app.use(/^\/api\/uploads\/[^/]+\/content$/, express.raw({ type: () => true, limit: rawLimit }));

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DatabaseExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false, credentials: true });

  if (process.env.SWAGGER_ENABLED !== 'false') {
    const config = new DocumentBuilder()
      .setTitle('Despina Pharma API')
      .setDescription('Website forms, lead dashboard, customer workspace and catalog CMS')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API on http://localhost:${port}/api  –  docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}
await bootstrap();

import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import * as helmetModule from 'helmet';
import { AppModule } from './app.module.js';
import { DatabaseExceptionFilter } from './common/filters/database-exception.filter.js';

// helmet ships CommonJS types, and Vercel type-checks this file with different module settings
// than `nest build`, so its typings resolve differently there. Do not rely on them: find the
// helmet function at runtime (it may be wrapped in one or two `.default` layers) and type it here.
type Middleware = (req: unknown, res: unknown, next: (err?: unknown) => void) => void;
function resolveHelmet(mod: unknown): () => Middleware {
  let candidate: unknown = mod;
  for (let i = 0; i < 3 && typeof candidate !== 'function'; i++) {
    candidate = (candidate as { default?: unknown } | null)?.default;
  }
  if (typeof candidate !== 'function') throw new Error('Could not load the helmet middleware');
  return candidate as () => Middleware;
}
const helmet = resolveHelmet(helmetModule);

/**
 * Creates and configures the Nest application (middleware, prefix, pipes, CORS, Swagger)
 * without listening. Used by main.ts (local / normal servers) and api/index.js (Vercel).
 */
export async function createApp(): Promise<NestExpressApplication> {
  // Startup diagnostics (no secrets): shows in the Vercel function log.
  const host = process.env.DB_HOST ?? '';
  Logger.log(
    `Database: host=${host.slice(0, 12)}…${host.slice(-22)} (${host.length} chars) port=${process.env.DB_PORT} ` +
      `ssl=${process.env.DB_SSL} pool=${process.env.DB_POOL_MAX} vercel=${!!process.env.VERCEL}`,
    'Bootstrap',
  );
  // abortOnError: false → a startup error (e.g. database unreachable) is thrown instead of
  // killing the process, so the Vercel handler can log it and answer with the reason.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { abortOnError: false });
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

  return app;
}

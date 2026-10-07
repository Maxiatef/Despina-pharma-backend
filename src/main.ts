import { Logger } from '@nestjs/common';
import { createApp } from './app.factory.js';

/** Local development and normal (always-on) servers. On Vercel, api/index.js is used instead. */
async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API on http://localhost:${port}/api  –  docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}
await bootstrap();

// Vercel entry point: every request is routed here (see vercel.json).
// The Nest app is built by `npm run build` into dist/ and started once per function
// instance, then reused for all following requests.
import { createApp } from '../dist/app.factory.js';

let ready; // Promise<express handler>, shared by concurrent first requests

async function start() {
  const app = await createApp();
  await app.init();
  return app.getHttpAdapter().getInstance();
}

export default async function handler(req, res) {
  try {
    ready ??= start();
    const server = await ready;
    return server(req, res);
  } catch (err) {
    ready = undefined; // try again on the next request
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vercel] Backend failed to start:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ statusCode: 503, error: 'Backend failed to start', message }));
  }
}

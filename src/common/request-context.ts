import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Tracking ID per request: taken from the `X-Request-Id` header (the website sends one with each form) or made here.
 * It is returned in the `X-Request-Id` response header and in error bodies, saved on inquiries and e-mail jobs
 * and written in the server log, so one form can be followed from the browser to the database and the e-mail.
 */
const store = new AsyncLocalStorage<{ requestId: string }>();
const VALID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestIdFrom(header: unknown) {
  return typeof header === 'string' && VALID.test(header) ? header : randomUUID();
}

export function currentRequestId(): string | null {
  return store.getStore()?.requestId ?? null;
}

type Req = { headers: Record<string, unknown>; requestId?: string };
type Res = { setHeader(name: string, value: string): void };

export function requestContext(req: Req, res: Res, next: () => void) {
  const requestId = requestIdFrom(req.headers['x-request-id']);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  store.run({ requestId }, next);
}

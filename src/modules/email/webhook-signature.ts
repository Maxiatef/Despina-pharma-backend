import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies a Resend webhook (Svix scheme): HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>" with the
 * base64 secret after "whsec_"; the svix-signature header holds one or more "v1,<base64>" values.
 * Timestamps more than 5 minutes off are refused (replay protection).
 */
export function verifyWebhookSignature(
  secret: string, rawBody: string, headers: { id?: string; timestamp?: string; signature?: string }, nowSeconds = Math.floor(Date.now() / 1000),
): { ok: true } | { ok: false; reason: string } {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing signature headers' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return { ok: false, reason: 'timestamp too old or invalid' };
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  for (const part of signature.split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    const given = Buffer.from(value, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: 'signature does not match' };
}

/** Builds valid headers for a body (used by the tests). */
export function signWebhook(secret: string, rawBody: string, id = `msg_${Date.now()}`, timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${sig}` };
}

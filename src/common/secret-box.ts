import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encrypts small secrets at rest (the 2FA key in users.mfa_secret) with AES-256-GCM.
 * Key: MFA_ENCRYPTION_KEY, else derived from APP_SECRET. Changing the key makes stored 2FA keys unreadable
 * (those staff then need "Reset 2FA" by an admin), so keep it stable per database.
 * Values without the "enc1:" prefix are older plain-text keys and are read as they are.
 */
const PREFIX = 'enc1:';

function key() {
  const raw = process.env.MFA_ENCRYPTION_KEY || (process.env.APP_SECRET ? `${process.env.APP_SECRET}:mfa` : '');
  if (raw.length < 32) throw new Error('MFA_ENCRYPTION_KEY or APP_SECRET (32+ characters) must be set');
  return createHash('sha256').update(raw).digest();
}

export function sealSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

export function openSecret(stored: string) {
  if (!stored.startsWith(PREFIX)) return stored;
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export const isSealed = (stored: string | null | undefined) => !!stored?.startsWith(PREFIX);

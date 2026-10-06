import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = () => {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error('APP_SECRET must be set (32+ characters)');
  return s;
};

/** Token proving the caller is the visitor who started this upload (lets anonymous visitors attach files to their inquiry). */
export const signUploadToken = (documentId: string) =>
  createHmac('sha256', secret()).update(`upload.${documentId}`).digest('base64url');

export function verifyUploadToken(documentId: string, token: string) {
  const a = Buffer.from(signUploadToken(documentId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

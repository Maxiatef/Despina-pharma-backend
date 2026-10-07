// Checks whether an uploaded file can still be downloaded later from the deployed API
// (Vercel keeps uploads in /tmp of one function instance, so they can disappear).
//   SMOKE_API=https://despina-pharma-backend.vercel.app/api node scripts/check-file-persistence.mjs DP-INQ-2026-000066
import 'dotenv/config';

const API = process.env.SMOKE_API ?? 'http://localhost:3000/api';
const ref = process.argv[2];
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}
const token = (await call('POST', '/auth/login', null, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).body.token;
const list = await call('GET', `/inquiries?q=${encodeURIComponent(ref)}`, token);
const inq = list.body.items?.[0];
const docs = await call('GET', `/inquiries/${inq.id}/documents`, token);
const v = docs.body[0]?.latestVersion;
console.log('document version', v?.id, 'scan', v?.scanStatus, 'uploaded', docs.body[0]?.createdAt);
if (v.scanStatus === 'pending') console.log('release:', (await call('POST', `/document-versions/${v.id}/scan`, token, { scanStatus: 'clean' })).status);
for (let i = 1; i <= 5; i++) {
  const link = await call('POST', `/document-versions/${v.id}/download-link`, token);
  const file = await fetch(API.replace(/\/api$/, '') + link.body.url);
  console.log(`attempt ${i}: link ${link.status}, download HTTP ${file.status}, ${file.headers.get('content-length') ?? '?'} bytes`);
}
await call('POST', '/auth/logout', token);

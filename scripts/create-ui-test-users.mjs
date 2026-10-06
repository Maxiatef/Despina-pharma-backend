// Creates two throwaway accounts for testing the website UI (removed by: node scripts/smoke-test.mjs --cleanup).
//   node scripts/create-ui-test-users.mjs <output.json>
// Uses ADMIN_EMAIL / ADMIN_PASSWORD from .env server-side only; writes the generated test
// passwords to the given file (never printed).
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const API = process.env.UI_API ?? 'http://localhost:3001/api'; // through the Next.js proxy
const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/create-ui-test-users.mjs <output.json>');

async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const admin = (await call('POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })).token;
const companies = await call('GET', `/companies?q=${encodeURIComponent('Smoke Test Browser Co')}`, null, admin);
const company = companies.items[0] ?? (await call('POST', '/companies', { name: 'Smoke Test Browser Co' }, admin));

const accounts = {};
for (const [key, role] of [['staff', 'admin'], ['customer', 'customer']]) {
  const email = `ui.${key}@smoke-test.invalid`;
  const password = `Ui-${randomBytes(9).toString('base64url')}`;
  const inv = await call('POST', '/users/invite', { email, role, companyId: role === 'customer' ? company.id : undefined }, admin);
  await call('POST', '/auth/accept-invite', { token: inv.inviteToken, password });
  accounts[key] = { email, password };
}
await writeFile(out, JSON.stringify({ ...accounts, companyId: company.id }, null, 2));
console.log(`created ${Object.values(accounts).map((a) => a.email).join(', ')} (company ${company.name}); passwords written to ${out}`);

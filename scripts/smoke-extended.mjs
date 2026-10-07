// Extended end-to-end test: everything scripts/smoke-test.mjs does not cover
// (MFA, password flows, sessions, users, companies, contacts, consents, catalog/content CMS,
// redirects, stage templates, documents & versions, tasks, email jobs, cron, webhooks,
// project edits) plus an access-control sweep over every private endpoint.
//
//   SMOKE_API=https://despina-pharma-backend.vercel.app/api node scripts/smoke-extended.mjs
//   node scripts/smoke-extended.mjs --keep      keep the test data
//   node scripts/smoke-extended.mjs --cleanup   only delete leftover test data
//
// Test data: emails @smoke-test.invalid, companies "Smoke Test ...", slugs/codes "smoke-x-...".
// Needs ADMIN_EMAIL / ADMIN_PASSWORD (.env) and, for the cron check, CRON_SECRET (.env.vercel).
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generate } from 'otplib';
import pg from 'pg';

const API = process.env.SMOKE_API ?? `http://localhost:${process.env.PORT ?? 3000}/api`;
const DOMAIN = 'smoke-test.invalid';
const RUN = Date.now().toString(36);
const args = new Set(process.argv.slice(2));
const CRON_SECRET = process.env.CRON_SECRET ?? readEnvFile('.env.vercel').CRON_SECRET;

function readEnvFile(path) {
  try {
    return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
  } catch { return {}; }
}

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  âœ” ${name}`); }
  else { failures.push(`${name}${detail !== undefined ? ` â†’ ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`); console.log(`  âœ˜ ${name}`, detail ?? ''); }
  return ok;
}
const section = (t) => console.log(`\nâ–¶ ${t}`);

// One request at a time: parallel bursts start many Vercel instances, each holding a DB
// connection, and the Clever Cloud plan allows only 5 (the API then fails with 503).
async function seq(list, fn) { const out = []; for (const x of list) out.push(await fn(x)); return out; }

async function call(method, path, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (raw) payload = raw;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const PDF2 = Buffer.concat([PDF, Buffer.from('% revision 2\n')]);

async function upload(token, opts = {}, bytes = PDF) {
  const init = await call('POST', '/uploads/initiate', { token, body: { filename: 'spec-sheet.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, ...opts } });
  if (init.status !== 201) return { init };
  const put = await call('PUT', `/uploads/${init.body.documentId}/content`, {
    token, raw: bytes, headers: { 'Content-Type': 'application/pdf', 'X-Upload-Token': init.body.uploadToken, 'X-Filename': 'spec-sheet.pdf' },
  });
  const done = await call('POST', '/uploads/complete', { body: { documentId: init.body.documentId, token: init.body.uploadToken } });
  return { init, put, done };
}

// The API allows 10 logins per 5 minutes per IP; this test signs in more often than that,
// so it clears its own login counters (rate_limits rows for this machine's IP) between sections.
async function resetLoginLimit() {
  const c = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query(`DELETE FROM rate_limits WHERE key LIKE 'login:%' AND (key LIKE $1 OR key ~ ':(127\\.0\\.0\\.1|::1)$' OR key LIKE $2)`,
      [`%:${process.env.SMOKE_CLIENT_IP ?? '127.0.0.1'}`, `%@${DOMAIN}`]);
  } finally {
    await c.end();
  }
}

async function inviteAndLogin(admin, email, role, extra = {}) {
  const inv = await call('POST', '/users/invite', { token: admin, body: { email, role, ...extra } });
  const password = `Smoke-${RUN}-${role}-Pw1!`;
  await call('POST', '/auth/accept-invite', { body: { token: inv.body.inviteToken, password } });
  const login = await call('POST', '/auth/login', { body: { email, password } });
  return { id: inv.body.user?.id, token: login.body.token, password, invite: inv };
}

// ---------------------------------------------------------------------------
async function run() {
  section('Login as admin');
  const login = await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  if (!check('admin login', login.status === 200 && login.body.token, login.body)) throw new Error('Admin login failed');
  const admin = login.body.token;
  const me = (await call('GET', '/auth/me', { token: admin })).body;

  // ---------- anonymous access sweep ----------
  section('Anonymous: every private endpoint answers 401');
  const Z = '00000000-0000-4000-8000-000000000000';
  const privateGets = ['/auth/me', '/auth/sessions', '/users', '/users/staff', `/users/${Z}`, '/companies', `/companies/${Z}`, '/contacts',
    `/contacts/${Z}`, `/contacts/${Z}/consents`, '/admin/catalog/categories', '/admin/catalog/sources', '/admin/catalog/items', '/admin/services',
    '/admin/faqs', '/admin/redirects', '/inquiries', '/inquiries/board', '/inquiries/summary', '/inquiries/export.csv', `/inquiries/${Z}`,
    `/inquiries/${Z}/messages`, `/inquiries/${Z}/documents`, '/projects', `/projects/${Z}`, `/projects/${Z}/timeline`, `/projects/${Z}/messages`,
    `/projects/${Z}/documents`, `/projects/${Z}/quotes`, `/projects/${Z}/approvals`, '/tasks', `/documents/${Z}`, '/dashboard/overview',
    '/dashboard/leads-per-week', '/stage-templates', `/briefs/${Z}`, `/samples/${Z}`, `/quotes/${Z}`, '/portal/me', '/portal/overview',
    '/email-jobs', `/email-jobs/${Z}/events`, '/audit-events'];
  const anon = await seq(privateGets, (p) => call('GET', p).then((r) => [p, r.status]));
  const leaks = anon.filter(([, s]) => s !== 401);
  check(`${privateGets.length} private GET endpoints need login`, leaks.length === 0, leaks);
  const privateWrites = [['POST', '/projects'], ['POST', '/tasks'], ['POST', '/companies'], ['POST', '/users/invite'], ['PATCH', `/inquiries/${Z}/status`],
    ['POST', `/document-versions/${Z}/scan`], ['POST', `/document-versions/${Z}/download-link`], ['POST', '/admin/faqs'], ['POST', '/stage-templates'],
    ['POST', '/auth/password/change'], ['POST', '/auth/mfa/setup'], ['POST', '/tasks/send-overdue-digest'], ['POST', `/email-jobs/${Z}/retry`]];
  const wr = await seq(privateWrites, ([m, p]) => call(m, p, { body: {} }).then((r) => [`${m} ${p}`, r.status]));
  check(`${privateWrites.length} private write endpoints need login`, wr.every(([, s]) => s === 401), wr.filter(([, s]) => s !== 401));
  check('fake bearer token rejected', (await call('GET', '/auth/me', { token: 'not-a-real-token' })).status === 401);

  // ---------- public extras ----------
  section('Public catalog & content extras');
  const items = await call('GET', '/public/catalog/items?pageSize=2');
  const anyItem = items.body.items?.[0];
  const byId = await call('GET', `/public/catalog/items/${anyItem?.id}`);
  check('catalog item by id', byId.status === 200 && byId.body.id === anyItem?.id);
  check('catalog item bad uuid â†’ 400', (await call('GET', '/public/catalog/items/not-a-uuid')).status === 400);
  check('catalog item unknown id â†’ 404', (await call('GET', `/public/catalog/items/${Z}`)).status === 404);
  const sources = await call('GET', '/public/catalog/sources');
  check('catalog sources (7)', sources.status === 200 && sources.body.length === 7, sources.body?.length);
  const total = (await call('GET', '/public/catalog/items?pageSize=1')).body.total;
  check('972 published catalog items', total === 972, total);
  const page2 = await call('GET', '/public/catalog/items?page=2&pageSize=24&sort=-name');
  check('pagination page 2 + sort', page2.status === 200 && page2.body.items.length === 24, page2.body?.items?.length);
  const bySource = await call('GET', '/public/catalog/items?source=rainshadow&pageSize=5');
  check('filter by source', bySource.status === 200 && bySource.body.total > 0, bySource.body?.total);
  const inject = await call('GET', `/public/catalog/items?q=${encodeURIComponent("' OR 1=1; DROP TABLE users;--")}`);
  check('SQL-injection text in search is harmless', inject.status === 200 && inject.body.total === 0, inject.body);
  check('bad sort value â†’ 400', (await call('GET', '/public/catalog/items?sort=price')).status === 400);
  check('huge pageSize rejected or capped', [200, 400].includes((await call('GET', '/public/catalog/items?pageSize=100000')).status));
  check('missing category â†’ 404', (await call('GET', '/public/catalog/categories/nope-nope')).status === 404);
  check('public FAQs list', (await call('GET', '/public/faqs')).status === 200);
  check('redirect resolve (none) does not crash', [200, 404].includes((await call('GET', '/public/redirects/resolve?path=/no-such-old-url/')).status));
  check('webhook email-events disabled until signature check', (await call('POST', '/webhooks/email-events', { body: { type: 'email.delivered', data: { email_id: 'x' } } })).body?.ignored === true);
  check('webhook email-inbound disabled until signature check', (await call('POST', '/webhooks/email-inbound', { body: { from: 'a@b.c', subject: 'DP-INQ-2026-000001', text: 'hi' } })).body?.ignored === true);
  check('cron without secret â†’ 401', (await call('GET', '/cron/run')).status === 401);
  check('cron with wrong secret â†’ 401', (await call('GET', '/cron/run', { headers: { Authorization: 'Bearer wrong' } })).status === 401);
  if (CRON_SECRET) {
    const cron = await call('GET', '/cron/email-queue', { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    check('cron email-queue with secret', cron.status === 200 && cron.body.ok === true, cron.body);
  } else console.log('  (skipped cron with secret â€“ CRON_SECRET not available)');
  check('unsubscribe with bad signature rejected', [400, 403].includes((await call('GET', `/public/unsubscribe?c=${Z}&s=bad`)).status));
  check('forgot password always answers OK (no account enumeration)',
    (await call('POST', '/auth/password/forgot', { body: { email: `nobody.${RUN}@${DOMAIN}` } })).status === 200);
  check('reset with forged token â†’ 400', (await call('POST', '/auth/password/reset', { body: { token: 'Zm9yZ2Vk', password: 'Whatever-123456' } })).status === 400);
  check('accept-invite with forged token â†’ 400', (await call('POST', '/auth/accept-invite', { body: { token: 'Zm9yZ2Vk', password: 'Whatever-123456' } })).status === 400);
  check('login: unknown email â†’ 401', (await call('POST', '/auth/login', { body: { email: `nobody.${RUN}@${DOMAIN}`, password: 'x' } })).status === 401);
  check('login: invalid body â†’ 400', (await call('POST', '/auth/login', { body: { email: 'not-an-email' } })).status === 400);

  section('Form validation edge cases');
  const base = { formType: 'contact', idempotencyKey: `smoke-${RUN}-edge-1`, contact: { firstName: 'Edge', email: `edge.${RUN}@${DOMAIN}` }, consent: { privacy: true } };
  check('bad email â†’ 400', (await call('POST', '/inquiries', { body: { ...base, contact: { firstName: 'x', email: 'bad' } } })).status === 400);
  check('unknown form type â†’ 400', (await call('POST', '/inquiries', { body: { ...base, formType: 'pizza' } })).status === 400);
  check('extra unknown field â†’ 400', (await call('POST', '/inquiries', { body: { ...base, isAdmin: true } })).status === 400);
  check('short idempotency key â†’ 400', (await call('POST', '/inquiries', { body: { ...base, idempotencyKey: 'x' } })).status === 400);
  check('missing consent â†’ 400', (await call('POST', '/inquiries', { body: { ...base, consent: undefined } })).status === 400);
  check('message > 10,000 chars â†’ 400', (await call('POST', '/inquiries', { body: { ...base, message: 'x'.repeat(10_001) } })).status === 400);
  const xss = await call('POST', '/inquiries', { body: { ...base, idempotencyKey: `smoke-${RUN}-xss`, message: '<script>alert(1)</script>', company: { name: `Smoke Test XSS ${RUN}` } } });
  check('HTML in message is accepted as text (stored, not executed)', xss.status === 201, xss.body);
  check('unknown service slug â†’ 400', (await call('POST', '/inquiries', { body: { ...base, idempotencyKey: `smoke-${RUN}-svc`, items: [{ serviceSlug: 'nope' }] } })).status === 400);

  // ---------- auth: MFA, password, sessions ----------
  section('Staff account: MFA, password change, sessions');
  const rnd = await inviteAndLogin(admin, `rnd.${RUN}@${DOMAIN}`, 'rnd');
  check('R&D staff invited and signed in', !!rnd.token, rnd.invite.body);
  const setup = await call('POST', '/auth/mfa/setup', { token: rnd.token });
  check('MFA setup returns secret + otpauth URL', setup.status === 201 && setup.body.secret && setup.body.otpauthUrl?.startsWith('otpauth://'), setup.body);
  check('MFA enable with wrong code â†’ 400', (await call('POST', '/auth/mfa/enable', { token: rnd.token, body: { code: '000000' } })).status === 400);
  const en = await call('POST', '/auth/mfa/enable', { token: rnd.token, body: { code: await generate({ secret: setup.body.secret }) } });
  check('MFA enable with real code', en.status === 200 && en.body.mfaEnabled === true, en.body);
  const noCode = await call('POST', '/auth/login', { body: { email: `rnd.${RUN}@${DOMAIN}`, password: rnd.password } });
  check('login now asks for the MFA code', noCode.status === 401 && noCode.body.mfaRequired === true, noCode.body);
  check('login with wrong MFA code â†’ 401', (await call('POST', '/auth/login', { body: { email: `rnd.${RUN}@${DOMAIN}`, password: rnd.password, mfaCode: '000000' } })).status === 401);
  const withCode = await call('POST', '/auth/login', { body: { email: `rnd.${RUN}@${DOMAIN}`, password: rnd.password, mfaCode: await generate({ secret: setup.body.secret }) } });
  check('login with MFA code; no setup prompt any more', withCode.status === 200 && withCode.body.mfaSetupRequired === false, withCode.body);
  const rndTok2 = withCode.body.token;
  const sess = await call('GET', '/auth/sessions', { token: rndTok2 });
  check('two sessions listed (no token hashes exposed)', sess.status === 200 && sess.body.length >= 2 && !JSON.stringify(sess.body).includes('tokenHash'), sess.body);
  const other = sess.body.find((s) => !s.current) ?? sess.body[1];
  check('revoke one session', (await call('DELETE', `/auth/sessions/${other.id}`, { token: rndTok2 })).status === 200);
  check('revoked session token stops working', (await call('GET', '/auth/me', { token: rnd.token })).status === 401);
  const reset = await call('POST', `/users/${rnd.id}/reset-mfa`, { token: admin });
  check('admin resets the user\'s MFA (and signs them out)', reset.status === 200, reset.body);
  check('reset-MFA ended the user\'s sessions', (await call('GET', '/auth/me', { token: rndTok2 })).status === 401);
  const relog = await call('POST', '/auth/login', { body: { email: `rnd.${RUN}@${DOMAIN}`, password: rnd.password } });
  check('login without MFA after reset', relog.status === 200 && relog.body.mfaSetupRequired === true, relog.body);
  const rndTok3 = relog.body.token;
  check('password change: wrong current â†’ 400', (await call('POST', '/auth/password/change', { token: rndTok3, body: { currentPassword: 'nope', newPassword: 'Another-Passw0rd!' } })).status === 400);
  check('password change: too short â†’ 400', (await call('POST', '/auth/password/change', { token: rndTok3, body: { currentPassword: rnd.password, newPassword: 'short' } })).status === 400);
  const newPw = `Smoke-${RUN}-Changed1!`;
  check('password change', (await call('POST', '/auth/password/change', { token: rndTok3, body: { currentPassword: rnd.password, newPassword: newPw } })).status === 200);
  check('old password no longer works', (await call('POST', '/auth/login', { body: { email: `rnd.${RUN}@${DOMAIN}`, password: rnd.password } })).status === 401);
  const rndTok4 = (await call('POST', '/auth/login', { body: { email: `rnd.${RUN}@${DOMAIN}`, password: newPw } })).body.token;
  check('new password works', !!rndTok4);
  check('revoke all sessions', (await call('POST', '/auth/sessions/revoke-all', { token: rndTok4 })).status < 300);
  check('â€¦and the token is dead', (await call('GET', '/auth/me', { token: rndTok4 })).status === 401);

  // ---------- users admin ----------
  section('Users (admin)');
  await resetLoginLimit();
  const users = await call('GET', `/users?q=${RUN}`, { token: admin });
  check('list users (search)', users.status === 200 && users.body.total >= 1, users.body);
  check('filter users by role', (await call('GET', '/users?role=rnd&active=true', { token: admin })).status === 200);
  check('get user', (await call('GET', `/users/${rnd.id}`, { token: admin })).body?.email === `rnd.${RUN}@${DOMAIN}`);
  check('user detail never exposes password hash / MFA secret', !/passwordHash|mfaSecret/.test(JSON.stringify((await call('GET', `/users/${rnd.id}`, { token: admin })).body)));
  check('admin cannot deactivate self', (await call('PATCH', `/users/${me.id}`, { token: admin, body: { isActive: false } })).status === 403);
  check('admin cannot demote self', (await call('PATCH', `/users/${me.id}`, { token: admin, body: { role: 'sales' } })).status === 403);
  const pend = await call('POST', '/users/invite', { token: admin, body: { email: `pending.${RUN}@${DOMAIN}`, role: 'packaging' } });
  const resend = await call('POST', `/users/${pend.body.user?.id}/resend-invite`, { token: admin });
  check('resend invite gives a fresh link', resend.status === 200 && resend.body.inviteToken, resend.body);
  check('invalid role â†’ 400', (await call('POST', '/users/invite', { token: admin, body: { email: `bad.${RUN}@${DOMAIN}`, role: 'god' } })).status === 400);
  check('change role', (await call('PATCH', `/users/${rnd.id}`, { token: admin, body: { role: 'production' } })).body?.role === 'production');

  // ---------- role sweep ----------
  section('Role-based access');
  await resetLoginLimit();
  const sales = await inviteAndLogin(admin, `sales.${RUN}@${DOMAIN}`, 'sales');
  const prod = await inviteAndLogin(admin, `prod.${RUN}@${DOMAIN}`, 'production');
  check('sales cannot list users', (await call('GET', '/users', { token: sales.token })).status === 403);
  check('sales can list staff for assignment', (await call('GET', '/users/staff', { token: sales.token })).status === 200);
  check('sales cannot read the audit log', (await call('GET', '/audit-events', { token: sales.token })).status === 403);
  check('sales cannot create stage templates', (await call('POST', '/stage-templates', { token: sales.token, body: { name: 'x', stages: [{ name: 'a' }] } })).status === 403);
  check('sales can use the catalog CMS', (await call('GET', '/admin/catalog/items?pageSize=1', { token: sales.token })).status === 200);
  check('sales can export CSV', (await call('GET', '/inquiries/export.csv?pageSize=1', { token: sales.token })).status === 200);
  check('production staff cannot export CSV', (await call('GET', '/inquiries/export.csv', { token: prod.token })).status === 403);
  check('production staff cannot use the CMS', (await call('GET', '/admin/faqs', { token: prod.token })).status === 403);
  check('production staff can see leads', (await call('GET', '/inquiries?pageSize=1', { token: prod.token })).status === 200);

  // ---------- companies, contacts, consents ----------
  section('Companies, contacts, consents');
  await resetLoginLimit();
  const co = await call('POST', '/companies', { token: admin, body: { name: `Smoke Test Brand ${RUN}`, website: 'example.com', country: 'EG' } });
  check('create company', co.status === 201, co.body);
  check('company: bad website â†’ 400', (await call('POST', '/companies', { token: admin, body: { name: `Smoke Test Bad ${RUN}`, website: 'not a url' } })).status === 400);
  check('list companies (search)', (await call('GET', `/companies?q=${RUN}`, { token: admin })).body?.total >= 1);
  check('update company', (await call('PATCH', `/companies/${co.body.id}`, { token: admin, body: { industry: 'Cosmetics' } })).body?.industry === 'Cosmetics');
  const ct = await call('POST', '/contacts', { token: admin, body: { companyId: co.body.id, firstName: 'Cora', lastName: 'Smoke', email: `cora.${RUN}@${DOMAIN}` } });
  check('create contact', ct.status === 201, ct.body);
  check('get contact', (await call('GET', `/contacts/${ct.body.id}`, { token: admin })).status === 200);
  check('update contact', (await call('PATCH', `/contacts/${ct.body.id}`, { token: admin, body: { jobTitle: 'Buyer' } })).body?.jobTitle === 'Buyer');
  check('contacts filtered by company', (await call('GET', `/contacts?companyId=${co.body.id}`, { token: admin })).body?.total === 1);
  check('record consent', (await call('POST', `/contacts/${ct.body.id}/consents`, { token: admin, body: { consentType: 'marketing', granted: true, policyVersion: '2026-10' } })).status === 201);
  check('consent history', (await call('GET', `/contacts/${ct.body.id}/consents`, { token: admin })).body?.length >= 1);
  const cust = await inviteAndLogin(admin, `cora.${RUN}@${DOMAIN}`, 'customer', { companyId: co.body.id, contactId: ct.body.id });
  check('customer invited into company and signed in', !!cust.token, cust.invite.body);
  const cust2Invite = await call('POST', '/users/invite', { token: admin, body: { email: `colleague.${RUN}@${DOMAIN}`, role: 'customer', companyId: co.body.id } });
  check('second customer user in the same company', cust2Invite.status === 201);

  // ---------- customer cannot reach staff areas ----------
  section('Customer access restrictions');
  const staffOnly = ['/companies', '/contacts', '/tasks', '/email-jobs', '/dashboard/overview', '/audit-events', '/stage-templates', '/users/staff',
    '/admin/catalog/items', '/admin/services', '/admin/faqs', '/admin/redirects', '/inquiries', '/inquiries/board', '/inquiries/export.csv'];
  const custSweep = await seq(staffOnly, (p) => call('GET', p, { token: cust.token }).then((r) => [p, r.status]));
  check(`customer gets 403 on ${staffOnly.length} staff areas`, custSweep.every(([, s]) => s === 403), custSweep.filter(([, s]) => s !== 403));
  check('customer cannot create projects', (await call('POST', '/projects', { token: cust.token, body: { companyId: co.body.id, name: 'x' } })).status === 403);
  check('customer cannot release files', (await call('POST', `/document-versions/${Z}/scan`, { token: cust.token, body: { scanStatus: 'clean' } })).status === 403);
  const portalMe = await call('GET', '/portal/me', { token: cust.token });
  check('portal: my profile and companies', portalMe.status === 200 && JSON.stringify(portalMe.body).includes(co.body.id), portalMe.body);

  // ---------- stage templates ----------
  section('Stage templates');
  const tplList = await call('GET', '/stage-templates', { token: admin });
  const def = tplList.body.find((t) => t.isDefault);
  check('default template exists', !!def);
  check('get template', (await call('GET', `/stage-templates/${def.id}`, { token: admin })).status === 200);
  const tpl = await call('POST', '/stage-templates', { token: admin, body: { name: `Smoke packaging-only ${RUN}`, stages: [{ name: 'Brief' }, { name: 'Packaging' }, { name: 'Quality Release', requiresRole: 'quality' }, { name: 'Dispatch' }] } });
  check('create packaging-only template', tpl.status === 201, tpl.body);
  check('empty template rejected', (await call('POST', '/stage-templates', { token: admin, body: { name: 'x', stages: [] } })).status === 400);
  check('rename template', (await call('PATCH', `/stage-templates/${tpl.body.id}`, { token: admin, body: { name: `Smoke packaging ${RUN}` } })).status === 200);

  // ---------- projects ----------
  section('Projects: edits, product lines, briefs, samples, quotes');
  const proj = await call('POST', '/projects', { token: admin, body: { companyId: co.body.id, name: `Smoke project ${RUN}`, stageTemplateId: tpl.body.id, ownerId: me.id } });
  check('project with a custom (packaging-only) template', proj.status === 201 && proj.body.stages?.length === 4, proj.body?.stages?.length);
  const pid = proj.body.id;
  check('customer sees the project in the list', (await call('GET', '/projects', { token: cust.token })).body?.items?.some((p) => p.id === pid));
  check('filter projects by company', (await call('GET', `/projects?companyId=${co.body.id}`, { token: admin })).body?.total === 1);
  check('put project on hold', (await call('PATCH', `/projects/${pid}`, { token: admin, body: { status: 'on_hold' } })).body?.status === 'on_hold');
  check('customer cannot edit project', (await call('PATCH', `/projects/${pid}`, { token: cust.token, body: { name: 'hacked' } })).status === 403);
  await call('PATCH', `/projects/${pid}`, { token: admin, body: { status: 'active' } });
  const line = await call('POST', `/projects/${pid}/products`, { token: cust.token, body: { name: 'Body lotion 250 ml', targetQuantity: 3000, notes: 'not sure yet about scent' } });
  check('customer adds a product line', line.status === 201, line.body);
  const line2 = await call('POST', `/projects/${pid}/products`, { token: cust.token, body: { name: 'Hand cream', targetQuantity: 1000 } });
  check('product line without name/item â†’ 400', (await call('POST', `/projects/${pid}/products`, { token: cust.token, body: { targetQuantity: 1 } })).status === 400);
  check('update product line', (await call('PATCH', `/project-products/${line.body.id}`, { token: cust.token, body: { targetQuantity: 5000 } })).body?.targetQuantity === 5000);
  check('customer removes a product line without samples', (await call('DELETE', `/project-products/${line2.body.id}`, { token: cust.token })).status === 200);
  const br = await call('POST', `/project-products/${line.body.id}/briefs`, { token: cust.token, body: { title: 'Lotion brief', content: { texture: 'light', fragrance: 'not sure yet' } } });
  check('brief v1', br.status === 201);
  check('list briefs', (await call('GET', `/project-products/${line.body.id}/briefs`, { token: cust.token })).body?.length === 1);
  check('get brief with versions', (await call('GET', `/briefs/${br.body.id}`, { token: cust.token })).body?.versions?.length === 1);
  const sample = await call('POST', `/project-products/${line.body.id}/samples`, { token: admin, body: { title: 'Lotion sample' } });
  check('list samples', (await call('GET', `/project-products/${line.body.id}/samples`, { token: cust.token })).body?.length === 1);
  check('customer cannot remove a product line that has samples', (await call('DELETE', `/project-products/${line.body.id}`, { token: cust.token })).status === 403);
  check('update sample status', (await call('PATCH', `/samples/${sample.body.id}`, { token: admin, body: { status: 'in_development' } })).body?.status === 'in_development');
  check('customer cannot change sample status', (await call('PATCH', `/samples/${sample.body.id}`, { token: cust.token, body: { status: 'approved' } })).status === 403);
  const r1 = await call('POST', `/samples/${sample.body.id}/revisions`, { token: admin, body: { description: 'A' } });
  check('revision 1', r1.status === 201 && r1.body.revisionNo === 1);
  check('ship revision (tracking)', (await call('PATCH', `/sample-revisions/${r1.body.id}`, { token: admin, body: { shippedAt: new Date().toISOString(), trackingNo: 'TRK-SMOKE' } })).body?.trackingNo === 'TRK-SMOKE');
  check('feedback rating 6 â†’ 400', (await call('POST', `/sample-revisions/${r1.body.id}/feedback`, { token: cust.token, body: { rating: 6 } })).status === 400);
  const sApprove = await call('POST', `/projects/${pid}/approvals`, { token: cust.token, body: { targetType: 'sample_revision', targetId: r1.body.id, confirmationText: 'Sample A approved' } });
  check('customer approves a sample revision', sApprove.status === 201 && sApprove.body.targetHash?.length === 64, sApprove.body);
  check('approved revision description is locked', (await call('PATCH', `/sample-revisions/${r1.body.id}`, { token: admin, body: { description: 'changed' } })).status === 409);
  check('sample â†’ approved', (await call('GET', `/samples/${sample.body.id}`, { token: cust.token })).body?.status === 'approved');
  const q = await call('POST', `/projects/${pid}/quotes`, { token: admin, body: { currency: 'EUR', lines: [{ description: 'Lotion', quantity: 1000, unitPrice: 2.5 }] } });
  check('quote created', q.status === 201);
  check('quote with no lines â†’ 400', (await call('POST', `/projects/${pid}/quotes`, { token: admin, body: { lines: [] } })).status === 400);
  check('customer cannot create quotes', (await call('POST', `/projects/${pid}/quotes`, { token: cust.token, body: { lines: [{ description: 'x', quantity: 1, unitPrice: 0 }] } })).status === 403);
  await call('POST', `/quotes/${q.body.id}/send`, { token: admin });
  check('customer lists sent quotes', (await call('GET', `/projects/${pid}/quotes`, { token: cust.token })).body?.some((x) => x.id === q.body.id));
  check('customer cannot set quote status (staff only)', (await call('PATCH', `/quotes/${q.body.id}`, { token: cust.token, body: { status: 'rejected' } })).status === 403);
  check('staff marks quote rejected', (await call('PATCH', `/quotes/${q.body.id}`, { token: admin, body: { status: 'rejected' } })).body?.status === 'rejected');
  check('rejected quote cannot be accepted', (await call('POST', `/projects/${pid}/approvals`, { token: cust.token, body: { targetType: 'quote_version', targetId: q.body.versions[0].id, confirmationText: 'accept it' } })).status === 400);
  check('approvals list', (await call('GET', `/projects/${pid}/approvals`, { token: cust.token })).body?.length >= 1);

  section('Documents: versions, approvals, scanning, visibility');
  const d1 = await upload(cust.token, { projectId: pid, visibility: 'customer', title: 'Artwork' });
  check('customer uploads artwork into project', d1.put?.status === 200, d1.put?.body ?? d1.init.body);
  const docId = d1.init.body.documentId;
  check('get document', (await call('GET', `/documents/${docId}`, { token: cust.token })).status === 200);
  check('customer cannot rename documents', (await call('PATCH', `/documents/${docId}`, { token: cust.token, body: { title: 'x' } })).status === 403);
  check('staff renames document', (await call('PATCH', `/documents/${docId}`, { token: admin, body: { title: 'Artwork front' } })).body?.title === 'Artwork front');
  await call('POST', `/document-versions/${d1.put.body.versionId}/scan`, { token: admin, body: { scanStatus: 'clean' } });
  const ap1 = await call('POST', `/projects/${pid}/approvals`, { token: cust.token, body: { targetType: 'document_version', targetId: d1.put.body.versionId, confirmationText: 'Artwork v1 approved' } });
  check('approve artwork v1', ap1.status === 201, ap1.body);
  const d2 = await upload(admin, { documentId: docId }, PDF2);
  check('upload artwork v2 (new version of the same document)', d2.put?.status === 200 && d2.put.body.versionId !== d1.put.body.versionId, d2.put?.body ?? d2.init.body);
  check('v1 can no longer be approved (only latest)', (await call('POST', `/projects/${pid}/approvals`, { token: admin, body: { targetType: 'document_version', targetId: d1.put.body.versionId, confirmationText: 'old version' } })).status === 400);
  check('v2 not approvable before scan', (await call('POST', `/projects/${pid}/approvals`, { token: cust.token, body: { targetType: 'document_version', targetId: d2.put.body.versionId, confirmationText: 'Artwork v2 approved' } })).status === 400);
  const docNow = await call('GET', `/documents/${docId}`, { token: admin });
  check('document shows 2 versions', JSON.stringify(docNow.body).includes(d2.put.body.versionId), docNow.body);
  const bad = await upload(admin, { projectId: pid, visibility: 'customer', title: 'Suspicious' });
  await call('POST', `/document-versions/${bad.put?.body.versionId}/scan`, { token: admin, body: { scanStatus: 'infected' } });
  check('infected file cannot be downloaded', (await call('POST', `/document-versions/${bad.put?.body.versionId}/download-link`, { token: admin })).status === 403);
  const internal = await upload(admin, { projectId: pid, visibility: 'internal', title: 'Costing' });
  check('customer cannot open an internal document by id', [403, 404].includes((await call('GET', `/documents/${internal.init.body.documentId}`, { token: cust.token })).status));
  check('customer cannot get a link for an internal file', [403, 404].includes((await call('POST', `/document-versions/${internal.put?.body.versionId}/download-link`, { token: cust.token })).status));
  check('upload into another company\'s project is refused', await (async () => {
    const otherCo = await call('POST', '/companies', { token: admin, body: { name: `Smoke Test Other2 ${RUN}` } });
    const op = await call('POST', '/projects', { token: admin, body: { companyId: otherCo.body.id, name: 'Other' } });
    const r = await call('POST', '/uploads/initiate', { token: cust.token, body: { filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, projectId: op.body.id } });
    return [403, 404].includes(r.status);
  })());
  check('anonymous upload into a project is refused', [401, 403].includes((await call('POST', '/uploads/initiate', { body: { filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, projectId: pid } })).status));

  // ---------- revoking access ----------
  section('Revoking customer access works immediately');
  await resetLoginLimit();
  check('customer can open the project', (await call('GET', `/projects/${pid}`, { token: cust.token })).status === 200);
  check('remove customer from company', (await call('DELETE', `/companies/${co.body.id}/members/${cust.id}`, { token: admin })).status < 300);
  check('â€¦project is closed to them at once', (await call('GET', `/projects/${pid}`, { token: cust.token })).status === 403);
  check('add customer back', (await call('POST', `/companies/${co.body.id}/members`, { token: admin, body: { userId: cust.id } })).status < 300);
  check('â€¦access restored', (await call('GET', `/projects/${pid}`, { token: cust.token })).status === 200);
  check('deactivate customer', (await call('PATCH', `/users/${cust.id}`, { token: admin, body: { isActive: false } })).status === 200);
  check('â€¦their token dies at once', (await call('GET', '/auth/me', { token: cust.token })).status === 401);
  check('â€¦and they cannot sign in', (await call('POST', '/auth/login', { body: { email: `cora.${RUN}@${DOMAIN}`, password: cust.password } })).status === 401);

  // ---------- tasks ----------
  section('Tasks');
  const t = await call('POST', '/tasks', { token: admin, body: { title: `Smoke task ${RUN}`, projectId: pid, assigneeId: sales.id, priority: 'normal' } });
  check('create task for another staff member', t.status === 201, t.body);
  check('invalid priority â†’ 400', (await call('POST', '/tasks', { token: admin, body: { title: 'x', priority: 'urgent!!' } })).status === 400);
  check('assignee sees it in "my tasks"', (await call('GET', '/tasks?assignee=me', { token: sales.token })).body?.items?.some((x) => x.id === t.body.id));
  check('edit task', (await call('PATCH', `/tasks/${t.body.id}`, { token: admin, body: { priority: 'high' } })).body?.priority === 'high');
  await call('POST', `/tasks/${t.body.id}/complete`, { token: sales.token });
  check('reopen task', (await call('POST', `/tasks/${t.body.id}/reopen`, { token: admin })).body?.completedAt === null);
  check('tasks of a project', (await call('GET', `/tasks?projectId=${pid}&state=all`, { token: admin })).body?.items?.length >= 1);
  check('delete task', (await call('DELETE', `/tasks/${t.body.id}`, { token: admin })).status === 200);

  // ---------- inquiries extras ----------
  section('Lead extras: unassign, messages, email jobs');
  const lead = await call('POST', '/inquiries', { body: { formType: 'contact', idempotencyKey: `smoke-${RUN}-lead-x`, contact: { firstName: 'Lena', email: `lena.${RUN}@${DOMAIN}` }, company: { name: `Smoke Test Lead ${RUN}` }, message: 'hello', consent: { privacy: true } } });
  check('lead created', lead.status === 201, lead.body);
  await call('POST', `/inquiries/${lead.body.id}/assign`, { token: admin, body: { userId: sales.id } });
  check('unassign lead', (await call('DELETE', `/inquiries/${lead.body.id}/assign`, { token: admin })).status === 200);
  check('lead filter: unassigned', (await call('GET', `/inquiries?unassigned=true&q=${RUN}`, { token: admin })).body?.items?.some((i) => i.id === lead.body.id));
  await call('POST', `/inquiries/${lead.body.id}/notes`, { token: admin, body: { note: 'INTERNAL-ONLY note' } });
  await call('POST', `/inquiries/${lead.body.id}/messages`, { token: admin, body: { body: 'Could you share your target quantity?' } });
  const msgs = await call('GET', `/inquiries/${lead.body.id}/messages`, { token: admin });
  check('lead messages list', msgs.status === 200 && msgs.body.length >= 1, msgs.body);
  check('internal notes are not mixed into customer messages', !JSON.stringify(msgs.body).includes('INTERNAL-ONLY'));
  const jobs = await call('GET', `/email-jobs?inquiryId=${lead.body.id}`, { token: admin });
  check('owner notice + customer ack queued for the lead', jobs.body?.items?.length >= 2, jobs.body?.items?.map((j) => j.kind));
  const job = jobs.body.items[0];
  check('email job events', (await call('GET', `/email-jobs/${job.id}/events`, { token: admin })).status === 200);
  check('retry email job', (await call('POST', `/email-jobs/${job.id}/retry`, { token: admin })).status === 200);
  check('filter email jobs by status', (await call('GET', '/email-jobs?status=queued&pageSize=5', { token: admin })).status === 200);
  check('date-range filter on leads', (await call('GET', `/inquiries?from=2026-01-01&to=2030-01-01&sort=oldest&pageSize=1`, { token: admin })).status === 200);
  check('convert with an unknown template â†’ 400/404', [400, 404].includes((await call('POST', `/inquiries/${lead.body.id}/convert`, { token: admin, body: { stageTemplateId: Z } })).status));
  const conv = await call('POST', `/inquiries/${lead.body.id}/convert`, { token: sales.token, body: { name: `Smoke converted ${RUN}`, stageTemplateId: tpl.body.id } });
  check('sales converts a lead with the packaging-only template', conv.status === 201 && conv.body.stages?.length === 4, conv.body);
  check('production staff cannot convert leads', (await call('POST', `/inquiries/${xss.body.id}/convert`, { token: prod.token, body: {} })).status === 403);
  check('audit log filtered by entity', (await call('GET', `/audit-events?entityType=project&pageSize=5`, { token: admin })).status === 200);

  // ---------- CMS ----------
  section('Catalog & content CMS');
  const cat = await call('POST', '/admin/catalog/categories', { token: admin, body: { slug: `smoke-x-${RUN}`, title: 'Smoke category', isPublished: false } });
  check('create category (unpublished)', cat.status === 201, cat.body);
  check('bad slug â†’ 400', (await call('POST', '/admin/catalog/categories', { token: admin, body: { slug: 'Bad Slug!', title: 'x' } })).status === 400);
  check('duplicate slug â†’ 409', (await call('POST', '/admin/catalog/categories', { token: admin, body: { slug: `smoke-x-${RUN}`, title: 'x' } })).status === 409);
  check('unpublished category hidden from public', (await call('GET', `/public/catalog/categories/smoke-x-${RUN}`)).status === 404);
  check('admin category list includes it', (await call('GET', '/admin/catalog/categories', { token: admin })).body?.some((c) => c.id === cat.body.id));
  const src = await call('POST', '/admin/catalog/sources', { token: admin, body: { code: `smoke-x-${RUN}`, name: 'Smoke supplier', website: 'https://example.com' } });
  check('create source', src.status === 201, src.body);
  check('update source', (await call('PATCH', `/admin/catalog/sources/${src.body.id}`, { token: admin, body: { name: 'Smoke supplier 2' } })).body?.name === 'Smoke supplier 2');
  check('admin sources list', (await call('GET', '/admin/catalog/sources', { token: admin })).body?.length >= 8);
  const it = await call('POST', '/admin/catalog/items', { token: admin, body: { categoryId: cat.body.id, sourceId: src.body.id, slug: `smoke-x-item-${RUN}`, name: 'Smoke item', isPublished: true, seoTitle: 'Smoke SEO' } });
  check('create catalog item', it.status === 201, it.body);
  check('update catalog item', (await call('PATCH', `/admin/catalog/items/${it.body.id}`, { token: admin, body: { notes: 'edited' } })).body?.notes === 'edited');
  check('admin item search', (await call('GET', `/admin/catalog/items?q=Smoke item`, { token: admin })).body?.total >= 1);
  check('publish category', (await call('PATCH', `/admin/catalog/categories/${cat.body.id}`, { token: admin, body: { isPublished: true } })).body?.isPublished === true);
  check('published item now on the public API', (await call('GET', `/public/catalog/categories/smoke-x-${RUN}/items/smoke-x-item-${RUN}`)).status === 200);
  const svc = await call('POST', '/admin/services', { token: admin, body: { slug: `smoke-x-${RUN}`, title: 'Smoke service', isPublished: false } });
  check('create service', svc.status === 201, svc.body);
  check('update service summary', (await call('PATCH', `/admin/services/${svc.body.id}`, { token: admin, body: { summary: 'Short summary' } })).body?.summary === 'Short summary');
  check('admin services list includes unpublished', (await call('GET', '/admin/services', { token: admin })).body?.length === 17);
  check('public services still 16', (await call('GET', '/public/services')).body?.length === 16);
  const faq = await call('POST', '/admin/faqs', { token: admin, body: { question: 'Smoke?', answer: 'Yes', topic: `smoke-${RUN}`, isPublished: true } });
  check('published FAQ visible on the website API', (await call('GET', `/public/faqs?topic=smoke-${RUN}`)).body?.length === 1);
  check('unpublish FAQ', (await call('PATCH', `/admin/faqs/${faq.body.id}`, { token: admin, body: { isPublished: false } })).body?.isPublished === false);
  check('â€¦hidden again', (await call('GET', `/public/faqs?topic=smoke-${RUN}`)).body?.length === 0);
  check('admin FAQ list', (await call('GET', `/admin/faqs?topic=smoke-${RUN}`, { token: admin })).body?.length === 1);
  await call('DELETE', `/admin/faqs/${faq.body.id}`, { token: admin });
  const red = await call('POST', '/admin/redirects', { token: admin, body: { fromPath: `/smoke-old-${RUN}/`, toPath: '/products/', statusCode: 301 } });
  check('create redirect', red.status === 201, red.body);
  check('bad redirect path â†’ 400', (await call('POST', '/admin/redirects', { token: admin, body: { fromPath: 'no-slash', toPath: '/x/' } })).status === 400);
  const resolved = await call('GET', `/public/redirects/resolve?path=/smoke-old-${RUN}/`);
  check('redirect resolves', resolved.status === 200 && resolved.body?.toPath === '/products/', resolved.body);
  check('update redirect', (await call('PATCH', `/admin/redirects/${red.body.id}`, { token: admin, body: { statusCode: 302 } })).body?.statusCode === 302);
  check('admin redirects list', (await call('GET', '/admin/redirects', { token: admin })).body?.some((r) => r.id === red.body.id));
  check('delete redirect', (await call('DELETE', `/admin/redirects/${red.body.id}`, { token: admin })).status === 200);

  section('Login rate limit');
  await resetLoginLimit();
  const tries = await seq([...Array(11).keys()], () => call('POST', '/auth/login', { body: { email: `limit.${RUN}@${DOMAIN}`, password: 'wrong-password' } }).then((r) => r.status));
  check('11th failed login within 5 minutes → 429', tries[10] === 429 && tries.slice(0, 10).every((s) => s === 401), tries);
  await resetLoginLimit();

  section('Company delete (admin only)');
  const tmp = await call('POST', '/companies', { token: admin, body: { name: `Smoke Test Temp ${RUN}` } });
  check('sales cannot delete companies', (await call('DELETE', `/companies/${tmp.body.id}`, { token: sales.token })).status === 403);
  check('admin deletes an empty company', (await call('DELETE', `/companies/${tmp.body.id}`, { token: admin })).status === 200);
  check('company with projects cannot be deleted', [400, 409].includes((await call('DELETE', `/companies/${co.body.id}`, { token: admin })).status));
}

// ---------------------------------------------------------------------------
async function cleanup() {
  console.log('\nâ–¶ Cleanup');
  // 1) everything the main smoke test knows how to remove (users, companies, inquiries, projects, filesâ€¦)
  execFileSync(process.execPath, ['scripts/smoke-test.mjs', '--cleanup'], { stdio: 'inherit', env: process.env });
  // 2) CMS / template records only this script creates
  const c = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN');
    const ids = (await c.query(`
      SELECT id FROM catalog_items WHERE slug LIKE 'smoke-x-%' UNION ALL SELECT id FROM catalog_categories WHERE slug LIKE 'smoke-x-%'
      UNION ALL SELECT id FROM catalog_sources WHERE code LIKE 'smoke-x-%' UNION ALL SELECT id FROM services WHERE slug LIKE 'smoke-x-%'
      UNION ALL SELECT id FROM stage_templates WHERE name LIKE 'Smoke %'`)).rows.map((r) => r.id);
    await c.query(`DELETE FROM tasks WHERE title LIKE 'Smoke task %'`);
    await c.query(`DELETE FROM catalog_items WHERE slug LIKE 'smoke-x-%'`);
    await c.query(`DELETE FROM catalog_categories WHERE slug LIKE 'smoke-x-%'`);
    await c.query(`DELETE FROM catalog_sources WHERE code LIKE 'smoke-x-%'`);
    await c.query(`DELETE FROM services WHERE slug LIKE 'smoke-x-%'`);
    await c.query(`DELETE FROM redirects WHERE from_path LIKE '/smoke-old-%'`);
    await c.query(`DELETE FROM faqs WHERE topic LIKE 'smoke-%'`);
    await c.query(`DELETE FROM stage_templates WHERE name LIKE 'Smoke %'`);
    await c.query(`DELETE FROM audit_events WHERE entity_id = ANY($1)`, [ids]);
    await c.query('COMMIT');
    console.log(`  removed ${ids.length} CMS/template records`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

try {
  if (!args.has('--cleanup')) { await cleanup(); await run(); }
} catch (err) {
  failures.push(`ABORTED: ${err.message}`);
  console.error(err);
} finally {
  if (!args.has('--keep')) await cleanup().catch((e) => failures.push(`cleanup failed: ${e.message}`));
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) console.log(` - ${failures.join('\n - ')}`);
  process.exit(failures.length ? 1 : 0);
}

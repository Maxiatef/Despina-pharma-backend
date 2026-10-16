// E-mail system test (Resend). Requests are sent one at a time.
//   npm run smoke:email                         safe mode: settings, switches, skipping, webhook – no real e-mail
//   npm run smoke:email -- --to you@gmail.com   + full flow: every e-mail type is really sent to that address
//                                               (with onboarding@resend.dev it must be the Resend account owner's address)
//   … --keep                                    keep the data (e.g. to look at it in Admin → Email log)
// Data: company "Smoke Test Email …", other addresses @smoke-test.invalid. Cleaned up afterwards.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const API = process.env.SMOKE_API ?? `http://localhost:${process.env.PORT ?? 3000}/api`;
const DOMAIN = 'smoke-test.invalid';
const RUN = `e${Date.now().toString(36)}`;
const argv = process.argv.slice(2);
const REAL = argv.includes('--to') ? argv[argv.indexOf('--to') + 1] : null;
const keep = argv.includes('--keep');
const SECRET = process.env.RESEND_WEBHOOK_SECRET;

let pass = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ✔ ${name}`); } else { failures.push(`${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail).slice(0, 300)}`}`); console.log(`  ✘ ${name}`, detail ?? ''); }
  return ok;
};
const section = (t) => console.log(`\n▶ ${t}`);
async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sign(raw, id = `msg_${RUN}_${Math.random().toString(36).slice(2)}`) {
  const ts = Math.floor(Date.now() / 1000);
  const key = Buffer.from(SECRET.startsWith('whsec_') ? SECRET.slice(6) : SECRET, 'base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64')}` };
}

let admin;
const jobs = async (filter) => (await call('GET', `/email-jobs?${new URLSearchParams({ pageSize: '100', ...filter })}`, { token: admin })).body.items ?? [];
/** Waits until the e-mails of a request are sent (they go out right after the request). */
async function sentTemplates(filter, since) {
  await sleep(500);
  return (await jobs(filter)).filter((j) => new Date(j.createdAt) >= since);
}

async function run() {
  if (!check('API is up', (await call('GET', '/health')).status === 200)) throw new Error(`API not reachable at ${API}`);
  let login = await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  if (login.status !== 200) {
    const out = spawnSync(process.execPath, ['scripts/qa-admin.mjs', 'create'], { encoding: 'utf8', env: process.env }).stdout;
    const env = Object.fromEntries(out.trim().split('\n').map((l) => l.split('=')));
    login = await call('POST', '/auth/login', { body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } });
  }
  if (!check('admin login', login.status === 200, login.body)) throw new Error('admin login failed');
  admin = login.body.token;

  section('Settings (admins only)');
  const settings = await call('GET', '/settings/email', { token: admin });
  check('GET /settings/email', settings.status === 200 && settings.body.staffNotifications.length === 14 && settings.body.customerEmails.length === 11, settings.body.status);
  check('status: provider + key + webhook secret reported (never the values)', 'resendKeySet' in settings.body.status && !JSON.stringify(settings.body).includes(process.env.RESEND_API_KEY ?? '§none§'));
  const original = settings.body.values;
  check('unknown key → 400', (await call('PATCH', '/settings/email', { token: admin, body: { values: { 'nope.key': 'x' } } })).status === 400);
  check('bad e-mail in a recipient list → 400', (await call('PATCH', '/settings/email', { token: admin, body: { values: { 'notify.inquiry.contact.to': 'not-an-email' } } })).status === 400);
  check('switch must be true/false → 400', (await call('PATCH', '/settings/email', { token: admin, body: { values: { 'customer.reply.enabled': 'maybe' } } })).status === 400);
  const preview = await call('GET', '/settings/email/preview/quote_ready', { token: admin });
  check('template preview (HTML with the Despina identity)', preview.status === 200 && String(preview.body).includes('Despina') && String(preview.body).includes('The art of beauty'));

  section('Nothing is sent to test addresses');
  const t0 = new Date();
  const testInquiry = await call('POST', '/inquiries', { body: {
    formType: 'contact', inquiryType: 'general', idempotencyKey: `smoke-${RUN}-skip`, contact: { firstName: 'Skip', email: `skip.${RUN}@${DOMAIN}` },
    company: { name: `Smoke Test Email ${RUN} skip` }, message: 'test', consent: { privacy: true } } });
  check('test form sent', testInquiry.status === 201, testInquiry.body);
  check('website is told: no confirmation e-mail for this one', testInquiry.body.confirmationEmail === false);
  const skipped = await sentTemplates({ inquiryId: testInquiry.body.id }, t0);
  check('its e-mails are stored as "skipped" with the reason', skipped.length >= 2 && skipped.every((j) => j.status === 'skipped' && /test/.test(j.lastError ?? '')), skipped.map((j) => [j.toEmail, j.status, j.lastError]));

  section('Webhook (signature required)');
  const body = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'none' } });
  check('unsigned call → 401', (await call('POST', '/webhooks/email-events', { raw: body })).status === 401);
  check('wrong signature → 401', (await call('POST', '/webhooks/email-events', { raw: body, headers: { 'svix-id': 'x', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,AAAA' } })).status === 401);
  if (SECRET) {
    const ok = await call('POST', '/webhooks/email-events', { raw: body, headers: sign(body) });
    check('correctly signed call → 200 (unknown e-mail id is ignored)', ok.status === 200 && ok.body.matched === false, ok.body);
    // bounce on a test e-mail: flags the (test) contact, which then is not e-mailed any more
    const victim = skipped.find((j) => j.toEmail === `skip.${RUN}@${DOMAIN}`);
    const fakeId = `smoke-${RUN}-bounce`;
    spawnSync(process.execPath, ['-e', `import('./dist/database/data-source.js').then(async ({default: ds}) => { await ds.initialize(); await ds.query("UPDATE email_jobs SET provider_message_id = $1 WHERE id = $2", ['${fakeId}', '${victim?.id}']); await ds.destroy(); })`], { stdio: 'inherit', env: process.env });
    const bounce = JSON.stringify({ type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: fakeId, bounce: { message: 'Mailbox does not exist' } } });
    const b = await call('POST', '/webhooks/email-events', { raw: bounce, headers: sign(bounce) });
    check('signed bounce is recorded', b.status === 200 && b.body.matched === true, b.body);
    const job = (await call('GET', `/email-jobs/${victim?.id}`, { token: admin })).body;
    check('e-mail log: last event "bounced" + event row', job.lastEvent === 'bounced' && job.events?.some((e) => e.event === 'bounced'), job);
    const lead = (await call('GET', `/inquiries/${testInquiry.body.id}`, { token: admin })).body;
    check('contact flagged "bounced" with the reason', lead.contact?.emailStatus === 'bounced' && /Mailbox/.test(lead.contact?.emailStatusDetail ?? ''), lead.contact);
    const cleared = await call('POST', `/contacts/${lead.contact.id}/clear-email-status`, { token: admin });
    check('staff can clear the status', cleared.status === 200 && cleared.body.emailStatus === null);
  } else console.log('  (RESEND_WEBHOOK_SECRET not set – signed webhook checks skipped)');

  if (!REAL) { console.log('\n(no --to address: real e-mail flow skipped)'); return; }

  // ===================================================================== real e-mails
  section(`Real e-mails to ${REAL}`);
  const realWait = async (filter, since, n = 1) => {
    for (let i = 0; i < 12; i++) {
      const rows = (await jobs(filter)).filter((j) => new Date(j.createdAt) >= since && j.toEmail === REAL.toLowerCase());
      if (rows.length >= n && rows.every((j) => j.status !== 'queued' && j.status !== 'sending')) return rows;
      await sleep(1000);
    }
    return (await jobs(filter)).filter((j) => new Date(j.createdAt) >= since && j.toEmail === REAL.toLowerCase());
  };
  const sentOk = (rows, template) => rows.some((j) => j.template === template && j.status === 'sent' && j.providerMessageId);

  let t = new Date();
  const inq = await call('POST', '/inquiries', { body: {
    formType: 'contact', inquiryType: 'quotation', idempotencyKey: `smoke-${RUN}-real`, sourcePage: '/contact/',
    contact: { firstName: 'Maximous', lastName: 'Email test', email: REAL }, company: { name: `Smoke Test Email ${RUN}` },
    message: 'E-mail system test: could you quote 2,000 units of a 30 ml face serum?', consent: { privacy: true },
    payload: { form: 'contact', fields: { inquiryType: 'Quotation / pricing', message: 'Quote please' }, labels: { inquiryType: 'Inquiry type', message: 'Your question' } } } });
  check('contact form sent', inq.status === 201, inq.body);
  check('website is told: confirmation e-mail on its way', inq.body.confirmationEmail === true, inq.body);
  let rows = await realWait({ inquiryId: inq.body.id }, t, 2);
  check('1 owner notice (team) sent', sentOk(rows, 'owner_notice'), rows.map((j) => [j.template, j.status, j.lastError]));
  check('2 customer confirmation sent', sentOk(rows, 'customer_ack'));

  t = new Date();
  await call('POST', `/inquiries/${inq.body.id}/messages`, { token: admin, body: { body: 'Thanks! Which fragrance and target retail price do you have in mind?', askInfo: true } });
  rows = await realWait({ inquiryId: inq.body.id }, t);
  check('3 "more information needed" sent', sentOk(rows, 'info_request'), rows.map((j) => [j.template, j.status, j.lastError]));
  check('…and the lead waits for the customer', (await call('GET', `/inquiries/${inq.body.id}`, { token: admin })).body.status === 'awaiting_customer');
  t = new Date();
  await call('POST', `/inquiries/${inq.body.id}/messages`, { token: admin, body: { body: 'Here is our price list for the serum range.' } });
  rows = await realWait({ inquiryId: inq.body.id }, t);
  check('4 team reply sent', sentOk(rows, 'message_to_customer'), rows.map((j) => [j.template, j.status]));

  const item = (await call('GET', '/public/catalog/items?q=serum&pageSize=1')).body.items?.[0];
  const conv = await call('POST', `/inquiries/${inq.body.id}/convert`, { token: admin, body: { name: `Email test project ${RUN}` } });
  check('convert to project', conv.status === 201, conv.body);
  const project = conv.body;
  const prod = await call('POST', `/projects/${project.id}/products`, { token: admin, body: { catalogItemId: item?.id, name: item ? undefined : 'Face serum 30 ml' } });
  const lead = (await call('GET', `/inquiries/${inq.body.id}`, { token: admin })).body;

  t = new Date();
  const inv = await call('POST', '/users/invite', { token: admin, body: { email: REAL, role: 'customer', companyId: project.companyId, contactId: lead.contactId } });
  check('invite created (e-mail queued)', inv.status === 201 && inv.body.emailStatus === 'queued', inv.body);
  rows = await realWait({ kind: 'invite' }, t);
  check('5 invitation sent', sentOk(rows, 'invite'), rows.map((j) => [j.template, j.status, j.lastError]));
  const password = `Smoke-${RUN}-Passw0rd!`;
  await call('POST', '/auth/accept-invite', { body: { token: inv.body.inviteToken, password } });
  const cust = (await call('POST', '/auth/login', { body: { email: REAL, password } })).body.token;
  check('customer can sign in', !!cust);

  t = new Date();
  const q = await call('POST', `/projects/${project.id}/quotes`, { token: admin, body: { currency: 'USD', validUntil: '2026-12-31', lines: [{ description: 'Face serum 30 ml', quantity: 2000, unitPrice: 2.3 }] } });
  await call('POST', `/quotes/${q.body.id}/send`, { token: admin });
  rows = await realWait({ projectId: project.id }, t);
  check('6 quote ready sent', sentOk(rows, 'quote_ready'), rows.map((j) => [j.template, j.status, j.lastError]));
  t = new Date();
  await call('POST', `/quotes/${q.body.id}/respond`, { token: cust, body: { decision: 'changes_requested', quoteVersionId: q.body.versions[0].id, note: 'Could you quote 3,000 units?' } });
  rows = await realWait({ projectId: project.id }, t, 2);
  check('7 quote answer → team notice sent', sentOk(rows, 'quote_response_staff'), rows.map((j) => [j.template, j.status]));
  check('8 quote answer → customer confirmation sent', sentOk(rows, 'quote_response_ack'));
  const rev = await call('POST', `/quotes/${q.body.id}/versions`, { token: admin, body: { lines: [{ description: 'Face serum 30 ml', quantity: 3000, unitPrice: 2.1 }] } });
  await call('POST', `/quotes/${q.body.id}/send`, { token: admin });
  t = new Date();
  await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'quote_version', targetId: rev.body.versions[0].id, confirmationText: 'I accept quote version 2' } });
  rows = await realWait({ projectId: project.id }, t, 2);
  check('9 quote accepted → team + customer confirmation sent', rows.filter((j) => j.status === 'sent').length >= 2, rows.map((j) => [j.template, j.status]));

  t = new Date();
  const sample = await call('POST', `/project-products/${prod.body.id}/samples`, { token: admin, body: { title: 'Face serum – version A' } });
  const r1 = await call('POST', `/samples/${sample.body.id}/revisions`, { token: admin, body: { description: 'First pass, lighter fragrance', shippedAt: new Date().toISOString(), trackingNo: '1Z999AA10123456784' } });
  rows = await realWait({ projectId: project.id }, t);
  check('10 sample shipped sent', sentOk(rows, 'sample_shipped'), rows.map((j) => [j.template, j.status]));
  t = new Date();
  const fr = await call('POST', `/sample-revisions/${r1.body.id}/request-feedback`, { token: admin });
  check('feedback request accepted', fr.status === 200, fr.body);
  rows = await realWait({ projectId: project.id }, t);
  check('11 feedback request sent', sentOk(rows, 'feedback_request'));
  t = new Date();
  await call('POST', `/sample-revisions/${r1.body.id}/feedback`, { token: cust, body: { rating: 4, comments: 'Lovely texture, fragrance a bit strong.' } });
  rows = await realWait({ projectId: project.id }, t);
  check('12 sample feedback → team notice sent', sentOk(rows, 'sample_feedback_staff'));

  // document: upload (customer-visible) → release → "new document" → request approval → customer approves
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const init = await call('POST', '/uploads/initiate', { token: admin, body: { filename: 'Formula-spec.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, projectId: project.id, visibility: 'customer', title: 'Formula specification' } });
  const put = await fetch(`${API}/uploads/${init.body.documentId}/content`, { method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/pdf', 'X-Upload-Token': init.body.uploadToken, 'X-Filename': 'Formula-spec.pdf' }, body: PDF });
  const versionId = (await put.json()).versionId;
  t = new Date();
  await call('POST', `/document-versions/${versionId}/scan`, { token: admin, body: { scanStatus: 'clean' } });
  rows = await realWait({ projectId: project.id }, t);
  check('13 new document available sent', sentOk(rows, 'document_ready'), rows.map((j) => [j.template, j.status]));
  t = new Date();
  const ra = await call('POST', `/documents/${init.body.documentId}/request-approval`, { token: admin, body: { note: 'Please check the INCI list.' } });
  check('approval request accepted', ra.status === 200, ra.body);
  rows = await realWait({ projectId: project.id }, t);
  check('14 approval requested sent', sentOk(rows, 'approval_request'));
  t = new Date();
  await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'document_version', targetId: versionId, confirmationText: 'I approve the formula specification v1' } });
  rows = await realWait({ projectId: project.id }, t);
  check('15 approval received → team notice sent', sentOk(rows, 'approval_staff'));

  t = new Date();
  const fresh = (await call('GET', `/projects/${project.id}`, { token: admin })).body;
  await call('POST', `/projects/${project.id}/stages/${fresh.currentStageId}/complete`, { token: admin, body: {} });
  rows = await realWait({ projectId: project.id }, t);
  check('16 stage update sent', sentOk(rows, 'stage_update'));
  t = new Date();
  await call('POST', `/projects/${project.id}/messages`, { token: cust, body: { body: 'Can we add a matching body lotion?' } });
  rows = await realWait({ projectId: project.id }, t);
  check('17 customer message → team notice sent', sentOk(rows, 'message_to_staff'));
  t = new Date();
  await call('POST', `/projects/${project.id}/messages`, { token: admin, body: { body: 'Yes – we will add it to the project.' } });
  rows = await realWait({ projectId: project.id }, t);
  check('18 team message → customer sent', sentOk(rows, 'message_to_customer'));
  t = new Date();
  await call('POST', '/auth/password/forgot', { body: { email: REAL } });
  rows = await realWait({ kind: 'password_reset' }, t);
  check('19 password reset sent', sentOk(rows, 'password_reset'));

  section('Switches');
  t = new Date();
  await call('PATCH', '/settings/email', { token: admin, body: { values: { 'customer.stage_update.enabled': 'false' } } });
  const next = (await call('GET', `/projects/${project.id}`, { token: admin })).body;
  await call('POST', `/projects/${project.id}/stages/${next.currentStageId}/complete`, { token: admin, body: {} });
  rows = await realWait({ projectId: project.id }, t, 0);
  check('customer e-mail switched off → nothing created', !rows.some((j) => j.template === 'stage_update'), rows.map((j) => j.template));
  await call('PATCH', '/settings/email', { token: admin, body: { values: { 'customer.stage_update.enabled': original['customer.stage_update.enabled'] ?? null, 'email.enabled': 'false' } } });
  t = new Date();
  await call('POST', `/projects/${project.id}/messages`, { token: admin, body: { body: 'This one is not sent (sending switched off).' } });
  rows = await realWait({ projectId: project.id }, t);
  check('master switch off → stored as skipped', rows.some((j) => j.status === 'skipped' && /switched off/.test(j.lastError ?? '')), rows.map((j) => [j.status, j.lastError]));
  await call('PATCH', '/settings/email', { token: admin, body: { values: { 'email.enabled': original['email.enabled'] ?? null } } });
  check('customer cannot read e-mail settings (403)', (await call('GET', '/settings/email', { token: cust })).status === 403);

  if (SECRET) {
    const sent = (await jobs({ projectId: project.id })).find((j) => j.status === 'sent' && j.providerMessageId);
    const ev = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: sent.providerMessageId } });
    const res = await call('POST', '/webhooks/email-events', { raw: ev, headers: sign(ev) });
    const job = (await call('GET', `/email-jobs/${sent.id}`, { token: admin })).body;
    check('webhook "delivered" for a real e-mail → shown in the log', res.body.matched === true && job.lastEvent === 'delivered');
  }
  globalThis.__cleanupRealUser = REAL;
}

try {
  await run();
} catch (e) {
  failures.push(`aborted: ${e.message}`);
  console.error(e);
}
console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✘ ${f}`);
if (!keep) {
  // The real-address customer user + its sessions, and the e-mail log rows of this run, then the usual cleanup.
  const real = globalThis.__cleanupRealUser ?? '';
  spawnSync(process.execPath, ['-e', `import('./dist/database/data-source.js').then(async ({default: ds}) => { await ds.initialize();
    const companies = (await ds.query("SELECT id FROM companies WHERE name LIKE 'Smoke Test Email ${RUN}%'")).map((r) => r.id);
    const users = (await ds.query("SELECT u.id FROM users u JOIN company_memberships m ON m.user_id = u.id WHERE m.company_id = ANY($1) AND lower(u.email) = lower($2)", [companies, '${real}'])).map((r) => r.id);
    await ds.query("DELETE FROM audit_events WHERE actor_id = ANY($1) OR company_id = ANY($2)", [users, companies]);
    await ds.query("DELETE FROM sessions WHERE user_id = ANY($1)", [users]);
    await ds.query("DELETE FROM approvals WHERE approver_id = ANY($1)", [users]);
    await ds.query("DELETE FROM email_jobs WHERE project_id IN (SELECT id FROM projects WHERE company_id = ANY($1)) OR inquiry_id IN (SELECT id FROM inquiries WHERE company_id = ANY($1)) OR (to_email = lower($2) AND created_at > now() - interval '2 hours' AND kind IN ('invite','password_reset')) OR subject LIKE '%Smoke Test%' OR body_text LIKE '%smoke-${RUN}%'", [companies, '${real}']);
    await ds.query("DELETE FROM users WHERE id = ANY($1)", [users]);
    const contacts = (await ds.query("SELECT id FROM contacts WHERE company_id = ANY($1)", [companies])).map((r) => r.id);
    const inqs = (await ds.query("SELECT id FROM inquiries WHERE company_id = ANY($1) OR contact_id = ANY($2)", [companies, contacts])).map((r) => r.id);
    await ds.query("DELETE FROM documents WHERE project_id IN (SELECT id FROM projects WHERE company_id = ANY($1))", [companies]);
    await ds.query("DELETE FROM projects WHERE company_id = ANY($1)", [companies]);
    await ds.query("DELETE FROM inquiries WHERE id = ANY($1)", [inqs]);
    await ds.query("DELETE FROM contacts WHERE id = ANY($1)", [contacts]);
    await ds.query("DELETE FROM companies WHERE id = ANY($1)", [companies]);
    await ds.query("DELETE FROM audit_events WHERE summary LIKE '%${RUN}%' OR entity_label LIKE '%${RUN}%' OR path LIKE '%${RUN}%'");
    console.log('  removed e-mail test data: ' + companies.length + ' companies, ' + users.length + ' users, ' + inqs.length + ' inquiries');
    await ds.destroy(); })`], { stdio: 'inherit', env: process.env });
  spawnSync(process.execPath, ['scripts/smoke-test.mjs', '--cleanup'], { stdio: 'inherit', env: process.env });
  spawnSync(process.execPath, ['scripts/qa-admin.mjs', 'remove'], { stdio: 'inherit', env: process.env });
}
process.exit(failures.length ? 1 : 0);

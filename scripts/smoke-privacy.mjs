// Tests for the features finished on 2026-10-15 (run against a running API, requests one at a time):
//   #9  spam holding area (held forms: no e-mails, no task; release / delete)
//   #10 tracking ID (X-Request-Id) on the request, the inquiry and its e-mails
//   #8  privacy requests: export / erase a person's data
//   #7  a customer company's main contact invites / removes colleagues
//
//   npm run smoke:privacy                 run + clean up
//   npm run smoke:privacy -- --keep       keep the data
// All data uses @smoke-test.invalid e-mails; erased test contacts are removed at the end.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const API = process.env.SMOKE_API ?? `http://localhost:${process.env.PORT ?? 3000}/api`;
const DOMAIN = 'smoke-test.invalid';
const RUN = `v${Date.now().toString(36)}`;
const keep = process.argv.includes('--keep');

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✔ ${name}`); }
  else { failures.push(`${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail).slice(0, 300)}`}`); console.log(`  ✘ ${name}`, detail ?? ''); }
  return ok;
}
const section = (t) => console.log(`\n▶ ${t}`);
async function call(method, path, { token, body, raw, headers: extra } = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
let n = 0;
const form = (extra = {}, who = `buyer.${RUN}`) => ({
  formType: 'contact',
  inquiryType: 'general',
  idempotencyKey: `smoke-${RUN}-${++n}-${Math.random().toString(36).slice(2, 8)}`,
  contact: { firstName: 'Smoke', lastName: `Privacy ${n}`, email: `${who}@${DOMAIN}` },
  company: { name: `Smoke Test Co ${RUN}` },
  message: `Smoke privacy test ${n}: we would like a quote for a face cream.`,
  sourcePage: '/contact/',
  consent: { privacy: true, policyVersion: '2026-10' },
  elapsedMs: 25_000,
  ...extra,
});

let ds;
async function db() {
  if (!ds) { ds = (await import('../dist/database/data-source.js')).default; await ds.initialize(); }
  return ds;
}
const erasedContacts = [];
const erasedUsers = [];

async function account(admin, email, role, extra = {}) {
  const inv = await call('POST', '/users/invite', { token: admin, body: { email, role, ...extra } });
  const password = `Smoke-${RUN}-Pw1!x`;
  await call('POST', '/auth/accept-invite', { body: { token: inv.body.inviteToken, password } });
  const login = await call('POST', '/auth/login', { body: { email, password } });
  return { id: inv.body.user?.id, token: login.body.token, password };
}

async function run() {
  const health = await call('GET', '/health');
  if (!check('API is up', health.status === 200, health)) throw new Error(`API not reachable at ${API}`);
  let login = await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  if (login.status !== 200) {
    const { default: bcrypt } = await import('bcryptjs');
    const email = `admin.${RUN}@${DOMAIN}`;
    const password = `Smoke-${RUN}-Admin1!`;
    await (await db()).query(`INSERT INTO users (email, password_hash, role, is_active) VALUES ($1, $2, 'admin', true)`, [email, await bcrypt.hash(password, 10)]);
    login = await call('POST', '/auth/login', { body: { email, password } });
  }
  if (!check('admin login', login.status === 200, login.body)) throw new Error('admin login failed');
  const admin = login.body.token;
  const sales = await account(admin, `sales.${RUN}@${DOMAIN}`, 'sales');

  // ------------------------------------------------------------------ #10 tracking ID
  section('#10 Tracking ID from the form to the database and the e-mails');
  check('every answer carries X-Request-Id', /^[0-9a-f-]{36}$/.test(health.headers.get('x-request-id') ?? ''), health.headers.get('x-request-id'));
  const trk = `smoke-${RUN}-track-1`;
  const t1 = await call('POST', '/inquiries', { body: form(), headers: { 'X-Request-Id': trk } });
  check('form sent', t1.status === 201, t1.body);
  check('the server answers with the same tracking ID', t1.headers.get('x-request-id') === trk, t1.headers.get('x-request-id'));
  const [ti] = await (await db()).query(`SELECT request_id FROM inquiries WHERE id = $1`, [t1.body.id]);
  check('tracking ID saved on the inquiry', ti?.request_id === trk, ti);
  const tj = await (await db()).query(`SELECT request_id FROM email_jobs WHERE inquiry_id = $1`, [t1.body.id]);
  check('tracking ID saved on its e-mails', tj.length > 0 && tj.every((j) => j.request_id === trk), tj);
  const lead = await call('GET', `/inquiries/${t1.body.id}`, { token: admin });
  check('lead page shows the tracking ID', lead.body.requestId === trk && lead.body.emails?.[0]?.requestId === trk, lead.body.requestId);
  const bad = await call('GET', '/health', { headers: { 'X-Request-Id': 'bad id <script>' } });
  check('an invalid tracking ID is replaced by a new one', /^[0-9a-f-]{36}$/.test(bad.headers.get('x-request-id') ?? ''), bad.headers.get('x-request-id'));

  // ------------------------------------------------------------------ #9 spam holding area
  section('#9 Spam holding area');
  const ok1 = await call('POST', '/inquiries', { body: form({ message: 'Please see our current range at https://brand.example/products – we want a similar serum.' }) });
  const [ok1Row] = await (await db()).query(`SELECT held_at FROM inquiries WHERE id = $1`, [ok1.body.id]);
  check('a normal form with one link is not held', ok1.status === 201 && ok1Row && ok1Row.held_at === null, ok1Row);
  const brief = await call('POST', '/inquiries', { body: form({ formType: 'new_product', payload: { form: 'product', fields: {
    benchmarks: 'https://a.example https://b.example https://c.example https://d.example', website: 'https://brand.example',
  } } }) });
  const [briefRow] = await (await db()).query(`SELECT held_at FROM inquiries WHERE id = $1`, [brief.body.id]);
  check('links in the benchmark / website fields do not count', brief.status === 201 && briefRow?.held_at === null, briefRow);

  const spam1 = await call('POST', '/inquiries', { body: form({ contact: { firstName: 'Visit https://cheap-pills.example', email: `spam1.${RUN}@${DOMAIN}` } }, 'x') });
  check('spam form still gets a normal answer (201)', spam1.status === 201 && spam1.body.referenceNo && spam1.body.confirmationEmail === false, spam1.body);
  const spam2 = await call('POST', '/inquiries', { body: form({ elapsedMs: 900 }, `spam2.${RUN}`) });
  const spam3 = await call('POST', '/inquiries', { body: form({ message: 'Best online casino bonus, click now' }, `spam3.${RUN}`) });
  const held = await (await db()).query(
    `SELECT id, held_at, hold_reasons, (SELECT count(*)::int FROM email_jobs e WHERE e.inquiry_id = i.id) AS emails,
            (SELECT count(*)::int FROM tasks t WHERE t.inquiry_id = i.id) AS tasks
     FROM inquiries i WHERE id = ANY($1)`, [[spam1.body.id, spam2.body.id, spam3.body.id]]);
  check('link in the name → held', held.find((h) => h.id === spam1.body.id)?.held_at, held);
  check('sent within 1 second of opening → held', held.find((h) => h.id === spam2.body.id)?.held_at);
  check('spam words → held', held.find((h) => h.id === spam3.body.id)?.hold_reasons?.some((r) => r.includes('casino')), held.find((h) => h.id === spam3.body.id));
  check('held forms: no e-mails and no follow-up task', held.length === 3 && held.every((h) => h.emails === 0 && h.tasks === 0), held);

  const list = await call('GET', '/inquiries?pageSize=100', { token: admin });
  check('held forms are left out of the lead list', list.status === 200 && !list.body.items.some((i) => i.id === spam1.body.id), list.body.total);
  const heldList = await call('GET', '/inquiries?held=true&pageSize=100', { token: admin });
  check('…and shown in the "held" list', heldList.body.items?.some((i) => i.id === spam1.body.id) && !heldList.body.items.some((i) => i.id === t1.body.id));
  const summary = await call('GET', '/inquiries/summary', { token: admin });
  check('summary counts held forms', summary.body.held >= 3, summary.body);
  const board = await call('GET', '/inquiries/board', { token: admin });
  check('board leaves held forms out', !JSON.stringify(board.body).includes(spam1.body.id));
  const dash = await call('GET', '/dashboard/overview', { token: admin });
  check('dashboard: held count and no held form in recent leads', dash.status === 200 && (dash.body.leads?.held >= 3 && !JSON.stringify(dash.body.recentLeads).includes(spam1.body.id)), dash.body?.leads);

  check('status change on a held form → 400', (await call('PATCH', `/inquiries/${spam2.body.id}/status`, { token: admin, body: { status: 'qualified' } })).status === 400);
  check('assigning a held form → 400', (await call('POST', `/inquiries/${spam2.body.id}/assign`, { token: admin, body: { userId: sales.id } })).status === 400);
  check('converting a held form → 400', (await call('POST', `/inquiries/${spam2.body.id}/convert`, { token: admin, body: {} })).status === 400);

  const rnd = await account(admin, `rnd.${RUN}@${DOMAIN}`, 'rnd');
  check('R&D cannot release → 403', (await call('POST', `/inquiries/${spam2.body.id}/release`, { token: rnd.token })).status === 403);
  const rel = await call('POST', `/inquiries/${spam2.body.id}/release`, { token: sales.token });
  check('sales releases it', rel.status === 200 && rel.body.heldAt === null, rel.body);
  const [after] = await (await db()).query(
    `SELECT (SELECT count(*)::int FROM email_jobs e WHERE e.inquiry_id = $1) AS emails, (SELECT count(*)::int FROM tasks t WHERE t.inquiry_id = $1) AS tasks`, [spam2.body.id]);
  check('released: team e-mail + confirmation written, follow-up task made', after.emails >= 2 && after.tasks === 1, after);
  check('releasing twice → 400', (await call('POST', `/inquiries/${spam2.body.id}/release`, { token: sales.token })).status === 400);
  check('released form is back in the lead list', (await call('GET', `/inquiries?q=${spam2.body.referenceNo}`, { token: admin })).body.total === 1);

  check('deleting a normal lead as spam → 400', (await call('DELETE', `/inquiries/${t1.body.id}/spam`, { token: admin })).status === 400);
  const del = await call('DELETE', `/inquiries/${spam3.body.id}/spam`, { token: admin });
  check('delete as spam', del.status === 200, del.body);
  check('…the form is gone', (await call('GET', `/inquiries/${spam3.body.id}`, { token: admin })).status === 404);
  const [gone] = await (await db()).query(`SELECT count(*)::int AS n FROM contacts WHERE email = $1`, [`spam3.${RUN}@${DOMAIN}`]);
  check('…and the contact it created', gone.n === 0, gone);
  const [kept] = await (await db()).query(`SELECT count(*)::int AS n FROM companies WHERE name = $1`, [`Smoke Test Co ${RUN}`]);
  check('…but not a company other forms use', kept.n === 1, kept);

  // A held form must not overwrite a real contact's details.
  const real = await call('POST', '/inquiries', { body: form({ contact: { firstName: 'Real', lastName: 'Person', email: `real.${RUN}@${DOMAIN}`, phone: '+1 555 0100' } }) });
  await call('POST', '/inquiries', { body: form({ elapsedMs: 100, contact: { firstName: 'Hacked', email: `real.${RUN}@${DOMAIN}`, phone: '000' } }) });
  const [rc] = await (await db()).query(`SELECT first_name, phone FROM contacts WHERE email = $1`, [`real.${RUN}@${DOMAIN}`]);
  check('a held form does not change an existing contact', real.status === 201 && rc?.first_name === 'Real' && rc.phone === '+1 555 0100', rc);

  // ------------------------------------------------------------------ #8 privacy requests
  section('#8 Privacy requests: export and erase a person\'s data');
  const file = Buffer.from('%PDF-1.4\n% smoke privacy\n');
  const init = await call('POST', '/uploads/initiate', { body: { filename: 'privacy-test.pdf', mimeType: 'application/pdf', sizeBytes: file.length } });
  await call('PUT', `/uploads/${init.body.documentId}/content`, { raw: file, headers: { 'Content-Type': 'application/pdf', 'X-Upload-Token': init.body.uploadToken, 'X-Filename': 'privacy-test.pdf' } });
  await call('POST', '/uploads/complete', { body: { documentId: init.body.documentId, token: init.body.uploadToken } });
  const pemail = `person.${RUN}@${DOMAIN}`;
  const p1 = await call('POST', '/inquiries', { body: form({
    contact: { firstName: 'Petra', lastName: 'Private', email: pemail, phone: '+44 20 0000 0000' },
    message: `My secret product idea ${RUN}`, payload: { form: 'contact', fields: { name: 'Petra Private', idea: `secret idea ${RUN}` } },
    uploads: [{ documentId: init.body.documentId, token: init.body.uploadToken }],
  }) });
  check('form with a file sent', p1.status === 201, p1.body);
  await call('POST', `/inquiries/${p1.body.id}/messages`, { token: admin, body: { body: `Hello Petra, about your idea ${RUN}` } });
  const contactId = (await call('GET', `/inquiries/${p1.body.id}`, { token: admin })).body.contact.id;

  const exp = await call('GET', `/contacts/${contactId}/export`, { token: admin });
  check('admin downloads the data (JSON file)', exp.status === 200 && (exp.headers.get('content-disposition') ?? '').includes('attachment'), exp.status);
  check('export: person, form answers, message, consent, e-mails, files',
    exp.body.person?.email === pemail && exp.body.forms?.[0]?.message?.includes(RUN) && exp.body.forms[0].answers?.idea
      && exp.body.messages?.some((m) => m.text.includes(RUN)) && exp.body.consents?.length >= 1 && exp.body.emailsSentToYou?.length >= 1
      && exp.body.files?.some((f) => f.filename === 'privacy-test.pdf'), exp.body);
  check('sales cannot export → 403', (await call('GET', `/contacts/${contactId}/export`, { token: sales.token })).status === 403);
  check('sales cannot erase → 403', (await call('POST', `/contacts/${contactId}/erase`, { token: sales.token, body: { confirm: pemail } })).status === 403);
  check('erase without the right e-mail → 400', (await call('POST', `/contacts/${contactId}/erase`, { token: admin, body: { confirm: 'wrong@x.invalid' } })).status === 400);

  const [fileRow] = await (await db()).query(`SELECT dv.storage_key FROM document_versions dv WHERE dv.document_id = $1`, [init.body.documentId]);
  const er = await call('POST', `/contacts/${contactId}/erase`, { token: admin, body: { confirm: pemail.toUpperCase() } });
  check('admin erases the person', er.status === 200 && er.body.filesDeleted === 1 && er.body.forms === 1, er.body);
  erasedContacts.push(contactId);
  const [ec] = await (await db()).query(`SELECT first_name, last_name, email, phone FROM contacts WHERE id = $1`, [contactId]);
  check('contact anonymised', ec?.first_name === 'Erased' && ec.last_name === null && ec.phone === null && ec.email.endsWith('@erased.invalid'), ec);
  const [ei] = await (await db()).query(`SELECT message, payload, ip FROM inquiries WHERE id = $1`, [p1.body.id]);
  check('form text and answers removed, lead kept', ei && ei.message === null && JSON.stringify(ei.payload) === '{}' && ei.ip === null, ei);
  const left = await (await db()).query(
    `SELECT 'message' AS t, body AS v FROM messages WHERE inquiry_id = $1
     UNION ALL SELECT 'email', coalesce(body_text, '') || to_email || subject FROM email_jobs WHERE inquiry_id = $1
     UNION ALL SELECT 'audit', coalesce(before::text, '') || coalesce(after::text, '') || coalesce(details::text, '') || coalesce(summary, '')
       FROM audit_events WHERE inquiry_id = $1 OR entity_id = $2`, [p1.body.id, contactId]);
  const leaks = left.filter((r) => r.v.includes(RUN) && (r.v.includes('Petra') || r.v.includes(pemail) || r.v.includes('secret')));
  check('no copy of the name, e-mail or text left in messages, e-mails or the activity log', leaks.length === 0, leaks);
  const [doc] = await (await db()).query(`SELECT count(*)::int AS n FROM documents WHERE id = $1`, [init.body.documentId]);
  const { existsSync } = await import('node:fs');
  check('their uploaded file is deleted (record and file)', doc.n === 0 && fileRow && !existsSync(`${process.env.STORAGE_DIR ?? './storage'}/${fileRow.storage_key}`), { doc, fileRow });
  const [ev] = await (await db()).query(`SELECT count(*)::int AS n FROM status_events WHERE inquiry_id = $1 AND note = 'Personal data removed on request'`, [p1.body.id]);
  check('the lead notes that data was removed', ev.n === 1);
  const [audit] = await (await db()).query(`SELECT after FROM audit_events WHERE action = 'contact.erase' AND entity_id = $1`, [contactId]);
  check('the erase itself is in the activity log (without personal data)', audit && !JSON.stringify(audit).includes(RUN), audit);

  const sc = await call('POST', '/contacts', { token: admin, body: { firstName: 'Staff', email: `sales.${RUN}@${DOMAIN}` } });
  await (await db()).query(`UPDATE users SET contact_id = $1 WHERE id = $2`, [sc.body.id, sales.id]);
  check('a staff member\'s contact cannot be erased here → 400', (await call('POST', `/contacts/${sc.body.id}/erase`, { token: admin, body: { confirm: `sales.${RUN}@${DOMAIN}` } })).status === 400);

  // ------------------------------------------------------------------ #7 company team
  section('#7 Customer company: the main contact invites colleagues');
  const co = await call('POST', '/companies', { token: admin, body: { name: `Smoke Test Team ${RUN}` } });
  const other = await call('POST', '/companies', { token: admin, body: { name: `Smoke Test Other ${RUN}` } });
  const owner = await account(admin, `owner.${RUN}@${DOMAIN}`, 'customer', { companyId: co.body.id, memberRole: 'owner' });
  const member = await account(admin, `member.${RUN}@${DOMAIN}`, 'customer', { companyId: co.body.id, memberRole: 'member' });
  const stranger = await account(admin, `stranger.${RUN}@${DOMAIN}`, 'customer', { companyId: other.body.id, memberRole: 'owner' });
  check('customer accounts ready', owner.token && member.token && stranger.token);

  const t0 = await call('GET', '/portal/team', { token: owner.token });
  const mine = t0.body.companies?.find((c) => c.id === co.body.id);
  check('main contact sees the team and may manage it', mine?.canManage === true && mine.people.length === 2 && mine.people.some((p) => p.isYou && p.role === 'owner'), t0.body);
  const tm = await call('GET', '/portal/team', { token: member.token });
  check('a member sees the team but may not manage it', tm.body.companies?.[0]?.canManage === false && tm.body.companies[0].people.length === 2, tm.body);
  check('a member cannot invite → 403', (await call('POST', '/portal/team/invite', { token: member.token, body: { companyId: co.body.id, email: `x.${RUN}@${DOMAIN}`, firstName: 'X' } })).status === 403);
  check('inviting into another company → 404', (await call('POST', '/portal/team/invite', { token: owner.token, body: { companyId: other.body.id, email: `y.${RUN}@${DOMAIN}`, firstName: 'Y' } })).status === 404);
  check('inviting an address that has an account → 409', (await call('POST', '/portal/team/invite', { token: owner.token, body: { companyId: co.body.id, email: `stranger.${RUN}@${DOMAIN}`, firstName: 'S' } })).status === 409);
  check('bad role → 400', (await call('POST', '/portal/team/invite', { token: owner.token, body: { companyId: co.body.id, email: `z.${RUN}@${DOMAIN}`, firstName: 'Z', role: 'admin' } })).status === 400);

  const cemail = `colleague.${RUN}@${DOMAIN}`;
  const inv = await call('POST', '/portal/team/invite', { token: owner.token, body: { companyId: co.body.id, email: cemail, firstName: 'Cora', lastName: 'Colleague', jobTitle: 'Buyer' } });
  check('main contact invites a colleague', inv.status === 201 && inv.body.id, inv.body);
  const [mail] = await (await db()).query(`SELECT body_text FROM email_jobs WHERE to_email = $1 AND template = 'invite' ORDER BY created_at DESC LIMIT 1`, [cemail]);
  check('invitation e-mail names the company', mail?.body_text?.includes(`Smoke Test Team ${RUN}`), mail?.body_text?.slice(0, 300));
  const t1b = await call('GET', '/portal/team', { token: owner.token });
  check('colleague listed as "invited"', t1b.body.companies[0].people.some((p) => p.email === cemail && p.status === 'invited' && p.name === 'Cora Colleague'));
  check('send the invitation again', (await call('POST', `/portal/team/${inv.body.id}/resend`, { token: owner.token })).status === 200);
  const token = mail?.body_text?.match(/token=([^\s&"]+)/)?.[1];
  const pw = `Smoke-${RUN}-Cora1!`;
  await call('POST', '/auth/accept-invite', { body: { token: decodeURIComponent(token ?? ''), password: pw } });
  const cora = (await call('POST', '/auth/login', { body: { email: cemail, password: pw } })).body.token;
  const coraMe = await call('GET', '/portal/me', { token: cora });
  check('colleague sets a password and sees the company', coraMe.status === 200 && coraMe.body.companies?.[0]?.id === co.body.id, coraMe.body);
  check('resend after the password is set → 400', (await call('POST', `/portal/team/${inv.body.id}/resend`, { token: owner.token })).status === 400);

  check('a member cannot remove anyone → 404', (await call('POST', `/portal/team/${inv.body.id}/remove`, { token: member.token })).status === 404);
  check('another company\'s owner cannot remove them → 404', (await call('POST', `/portal/team/${inv.body.id}/remove`, { token: stranger.token })).status === 404);
  check('removing yourself → 400', (await call('POST', `/portal/team/${owner.id}/remove`, { token: owner.token })).status === 400);
  const rm = await call('POST', `/portal/team/${inv.body.id}/remove`, { token: owner.token });
  check('main contact removes the colleague', rm.status === 200, rm.body);
  check('…their access stops at once (401)', (await call('GET', '/portal/me', { token: cora })).status === 401);
  check('…and they are no longer listed', !(await call('GET', '/portal/team', { token: owner.token })).body.companies[0].people.some((p) => p.email === cemail));

  // Erasing a customer who has a login closes it.
  const mc = await call('POST', '/contacts', { token: admin, body: { firstName: 'Member', email: `member.${RUN}@${DOMAIN}`, companyId: co.body.id } });
  await (await db()).query(`UPDATE users SET contact_id = $1 WHERE id = $2`, [mc.body.id, member.id]);
  const er2 = await call('POST', `/contacts/${mc.body.id}/erase`, { token: admin, body: { confirm: `member.${RUN}@${DOMAIN}` } });
  check('erasing a customer with a login', er2.status === 200 && er2.body.accounts === 1, er2.body);
  erasedContacts.push(mc.body.id); erasedUsers.push(member.id);
  check('…closes the login at once', (await call('GET', '/portal/me', { token: member.token })).status === 401);
}

try {
  await run();
} catch (e) {
  failures.push(`aborted: ${e.message}`);
  console.error(e);
}

// Erased test people no longer have a @smoke-test.invalid address, so remove them here.
try {
  if (!keep && (erasedContacts.length || erasedUsers.length)) {
    const d = await db();
    await d.query(`DELETE FROM audit_events WHERE entity_id = ANY($1) OR actor_id = ANY($2)`, [[...erasedContacts, ...erasedUsers], erasedUsers]);
    await d.query(`DELETE FROM email_jobs WHERE inquiry_id IN (SELECT id FROM inquiries WHERE contact_id = ANY($1))`, [erasedContacts]);
    await d.query(`DELETE FROM inquiries WHERE contact_id = ANY($1)`, [erasedContacts]);
    await d.query(`DELETE FROM users WHERE id = ANY($1)`, [erasedUsers]);
    await d.query(`DELETE FROM contacts WHERE id = ANY($1)`, [erasedContacts]);
  }
} catch (e) {
  failures.push(`clean-up of erased test people failed: ${e.message}`);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✘ ${f}`);
if (ds) await ds.destroy();
if (!keep) {
  const r = spawnSync(process.execPath, ['scripts/smoke-test.mjs', '--cleanup'], { stdio: 'inherit', env: process.env });
  if (r.status) failures.push('cleanup failed');
}
process.exit(failures.length ? 1 : 0);

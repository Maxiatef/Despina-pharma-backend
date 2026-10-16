// Tests for the work of 2026-10-16 (run against a running API started with REQUIRE_STAFF_MFA=true):
//   two-factor login finished: staff must turn it on, encrypted key, 10 backup codes, wrong-code limit
//   target date (internal) vs promised date (customer)
//   reminders: waiting on the customer (reminder e-mails, caps, stop rules, pause, opt-out) / waiting on us
//
//   npm run smoke:reminders               run + clean up
//   npm run smoke:reminders -- --keep     keep the data
// Uses its own admin and @smoke-test.invalid e-mails only (nothing is e-mailed to a real address).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { generate } from 'otplib';

const API = process.env.SMOKE_API ?? `http://localhost:${process.env.PORT ?? 3000}/api`;
const DOMAIN = 'smoke-test.invalid';
const RUN = `r${Date.now().toString(36)}`;
const keep = process.argv.includes('--keep');

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✔ ${name}`); }
  else { failures.push(`${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail).slice(0, 300)}`}`); console.log(`  ✘ ${name}`, detail ?? ''); }
  return ok;
}
const section = (t) => console.log(`\n▶ ${t}`);
let ipN = 0;
async function call(method, path, { token, body, form, headers: extra } = {}) {
  // Each call looks like a different visitor, so the per-IP login limit does not stop the test.
  const headers = { 'X-Forwarded-For': `10.77.${Math.floor(++ipN / 250)}.${ipN % 250}`, ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(API + path, { method, headers, body: form ? new URLSearchParams(form).toString() : body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const login = (email, password, mfaCode) => call('POST', '/auth/login', { body: { email, password, mfaCode } });
const totp = (secret) => generate({ secret });

let ds;
async function db() {
  if (!ds) { ds = (await import('../dist/database/data-source.js')).default; await ds.initialize(); }
  return ds;
}
const q = async (sql, params) => (await db()).query(sql, params);

/** Staff account with two-factor login turned on (the way a new team member does it). */
async function staffWithMfa(admin, email, role) {
  const inv = await call('POST', '/users/invite', { token: admin, body: { email, role } });
  const password = `Smoke-${RUN}-Pw1!x`;
  await call('POST', '/auth/accept-invite', { body: { token: inv.body.inviteToken, password } });
  const first = await login(email, password);
  const setup = await call('POST', '/auth/mfa/setup', { token: first.body.token });
  const on = await call('POST', '/auth/mfa/enable', { token: first.body.token, body: { code: await totp(setup.body.secret) } });
  return { id: inv.body.user?.id, email, password, secret: setup.body.secret, token: first.body.token, backupCodes: on.body.backupCodes, first };
}

async function run() {
  const health = await call('GET', '/health');
  if (!check('API is up', health.status === 200, health)) throw new Error(`API not reachable at ${API}`);

  // ------------------------------------------------------------------ two-factor login
  section('Two-factor login is required for staff');
  const { default: bcrypt } = await import('bcryptjs');
  const adminEmail = `admin.${RUN}@${DOMAIN}`;
  const adminPass = `Smoke-${RUN}-Admin1!`;
  await q(`INSERT INTO users (email, password_hash, role, is_active) VALUES ($1, $2, 'admin', true)`, [adminEmail, await bcrypt.hash(adminPass, 10)]);
  const a1 = await login(adminEmail, adminPass);
  check('staff login without 2FA → told to set it up', a1.status === 200 && a1.body.mfaSetupRequired === true, a1.body);
  const pending = a1.body.token;
  const blocked = await call('GET', '/inquiries', { token: pending });
  check('…and the dashboard is blocked until it is on', blocked.status === 403 && blocked.body.mfaSetupRequired === true, blocked.body);
  check('…other staff routes too (projects)', (await call('GET', '/projects', { token: pending })).status === 403);
  const me = await call('GET', '/auth/me', { token: pending });
  check('…but "who am I" works and says 2FA is pending', me.status === 200 && me.body.mfaPending === true, me.body);
  check('…my account works', (await call('GET', '/portal/me', { token: pending })).status === 200);
  check('…my devices work', (await call('GET', '/auth/sessions', { token: pending })).status === 200);
  const st = await call('GET', '/auth/mfa', { token: pending });
  check('2FA status: off, required', st.status === 200 && st.body.enabled === false && st.body.required === true, st.body);
  const setup = await call('POST', '/auth/mfa/setup', { token: pending });
  check('set up 2FA → key + QR link', setup.status === 201 && setup.body.secret && setup.body.otpauthUrl?.startsWith('otpauth://'), setup.body);
  const [row] = await q(`SELECT mfa_secret FROM users WHERE email = $1`, [adminEmail]);
  check('the 2FA key is stored encrypted (not the plain key)', row.mfa_secret.startsWith('enc1:') && !row.mfa_secret.includes(setup.body.secret));
  check('a wrong code does not turn it on', (await call('POST', '/auth/mfa/enable', { token: pending, body: { code: '000000' } })).status === 400);
  const on = await call('POST', '/auth/mfa/enable', { token: pending, body: { code: await totp(setup.body.secret) } });
  check('turn on with the app code → 10 backup codes', on.status === 200 && on.body.backupCodes?.length === 10 && new Set(on.body.backupCodes).size === 10, on.body);
  check('backup codes look like xxxxx-xxxxx', on.body.backupCodes?.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)));
  const [row2] = await q(`SELECT mfa_backup_codes FROM users WHERE email = $1`, [adminEmail]);
  check('only hashes of the backup codes are stored', row2.mfa_backup_codes.length === 10 && !JSON.stringify(row2.mfa_backup_codes).includes(on.body.backupCodes[0]));
  check('the same session now opens the dashboard', (await call('GET', '/inquiries', { token: pending })).status === 200);
  const audit = await q(`SELECT to_jsonb(a) AS row FROM audit_events a WHERE actor_id = (SELECT id FROM users WHERE email = $1) AND action LIKE 'auth.mfa%'`, [adminEmail]);
  check('the audit log keeps no key or backup code', audit.length >= 1 && !JSON.stringify(audit).includes(setup.body.secret) && !JSON.stringify(audit).includes(on.body.backupCodes[0]), audit.length);
  const off = await call('POST', '/auth/mfa/disable', { token: pending, body: { code: await totp(setup.body.secret) } });
  check('staff cannot turn 2FA off', off.status === 400, off.body);

  const noCode = await login(adminEmail, adminPass);
  check('next login asks for the code', noCode.status === 401 && JSON.stringify(noCode.body).includes('mfaRequired'), noCode.body);
  const withCode = await login(adminEmail, adminPass, await totp(setup.body.secret));
  check('login with the app code', withCode.status === 200 && withCode.body.mfaSetupRequired === false, withCode.body);
  const admin = withCode.body.token;
  const backup = on.body.backupCodes[0];
  const withBackup = await login(adminEmail, adminPass, backup.toUpperCase().replace('-', ' '));
  check('login with a backup code (any case / spacing) → 9 left', withBackup.status === 200 && withBackup.body.backupCodesLeft === 9, withBackup.body);
  check('the same backup code works only once', (await login(adminEmail, adminPass, backup)).status === 401);
  check('status shows 9 backup codes left', (await call('GET', '/auth/mfa', { token: admin })).body.backupCodesLeft === 9);
  const renewed = await call('POST', '/auth/mfa/backup-codes', { token: admin, body: { code: await totp(setup.body.secret) } });
  check('make new backup codes (needs the app code)', renewed.status === 200 && renewed.body.backupCodes.length === 10);
  check('old backup codes stop working', (await login(adminEmail, adminPass, on.body.backupCodes[1])).status === 401);
  check('new backup codes work', (await login(adminEmail, adminPass, renewed.body.backupCodes[0])).status === 200);

  section('Wrong-code limit');
  const sales = await staffWithMfa(admin, `sales.${RUN}@${DOMAIN}`, 'sales');
  check('new staff member turns 2FA on', !!sales.backupCodes?.length && sales.first.body.mfaSetupRequired === true);
  for (let i = 0; i < 5; i++) await login(sales.email, sales.password, '123456');
  const locked = await login(sales.email, sales.password, await totp(sales.secret));
  check('after 5 wrong codes even the right code waits 15 minutes', locked.status === 429, locked.body);
  await q(`DELETE FROM rate_limits WHERE key = $1`, [`mfa-fail:${sales.id}`]);
  const salesLogin = await login(sales.email, sales.password, await totp(sales.secret));
  check('…and works again after the wait', salesLogin.status === 200);
  let salesToken = salesLogin.body.token;

  section('Admin reset and customers');
  const reset = await call('POST', `/users/${sales.id}/reset-mfa`, { token: admin });
  check('admin resets a lost 2FA', reset.status === 200);
  const afterReset = await login(sales.email, sales.password);
  check('…the person logs in with the password and must set it up again', afterReset.status === 200 && afterReset.body.mfaSetupRequired === true);
  const [row3] = await q(`SELECT mfa_secret, mfa_backup_codes FROM users WHERE id = $1`, [sales.id]);
  check('…old key and backup codes are deleted', row3.mfa_secret === null && row3.mfa_backup_codes === null);
  const s2 = await call('POST', '/auth/mfa/setup', { token: afterReset.body.token });
  await call('POST', '/auth/mfa/enable', { token: afterReset.body.token, body: { code: await totp(s2.body.secret) } });
  sales.secret = s2.body.secret;
  check('reset signed the person out everywhere', (await call('GET', '/auth/me', { token: salesToken })).status === 401);
  salesToken = afterReset.body.token;

  // ------------------------------------------------------------------ customer + project
  section('Set-up: company, customer, project');
  const co = await call('POST', '/companies', { token: admin, body: { name: `Smoke Test Reminders ${RUN}` } });
  const custEmail = `buyer.${RUN}@${DOMAIN}`;
  const ct = await call('POST', '/contacts', { token: admin, body: { firstName: 'Rita', lastName: 'Reminder', email: custEmail, companyId: co.body.id } });
  const inv = await call('POST', '/users/invite', { token: admin, body: { email: custEmail, role: 'customer', companyId: co.body.id, contactId: ct.body.id } });
  const custPass = `Smoke-${RUN}-Cust1!`;
  await call('POST', '/auth/accept-invite', { body: { token: inv.body.inviteToken, password: custPass } });
  const custLogin = await login(custEmail, custPass);
  check('customers do not have to use 2FA', custLogin.status === 200 && custLogin.body.mfaSetupRequired === false);
  const cust = custLogin.body.token;
  check('customer is not blocked', (await call('GET', '/portal/overview', { token: cust })).status === 200);
  const custMfa = await call('GET', '/auth/mfa', { token: cust });
  check('customers may turn 2FA on, it is not required', custMfa.body.required === false);
  const prj = await call('POST', '/projects', { token: admin, body: { companyId: co.body.id, name: `Reminder project ${RUN}`, ownerId: sales.id } });
  check('project created with an owner', prj.status === 201, prj.body);
  const projectId = prj.body.id;
  const prod = await call('POST', `/projects/${projectId}/products`, { token: admin, body: { name: 'Face cream 50 ml' } });

  // ------------------------------------------------------------------ dates
  section('Target date (internal) and promised date (customer)');
  const bad = await call('PATCH', `/projects/${projectId}`, { token: admin, body: { promisedDate: '2026-13-45' } });
  check('an invalid date is refused', bad.status === 400);
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const d1 = await call('PATCH', `/projects/${projectId}`, { token: admin, body: { targetDate: later, promisedDate: soon } });
  check('staff set target + promised date', d1.status === 200 && d1.body.targetDate === later && d1.body.promisedDate === soon, d1.body);
  const cv = await call('GET', `/projects/${projectId}`, { token: cust });
  check('customer sees the promised date', cv.body.promisedDate === soon);
  check('…but never the internal target date', !('targetDate' in cv.body) && cv.body.products.every((p) => !('targetDate' in p)), Object.keys(cv.body));
  check('…not in the project list either', (await call('GET', '/projects', { token: cust })).body.items.every((p) => !('targetDate' in p)));
  const ov = await call('GET', '/portal/overview', { token: cust });
  check('portal overview shows the expected date', ov.body.projects.find((p) => p.id === projectId)?.promisedDate === soon);
  const d2 = await call('PATCH', `/projects/${projectId}`, { token: admin, body: { promisedDate: later, dateReason: 'Bottle supplier is late' } });
  check('promised date moved with a reason', d2.status === 200 && d2.body.promisedDate === later);
  const tl = await call('GET', `/projects/${projectId}/timeline`, { token: cust });
  check('…the change and the reason show on the timeline', tl.body.some((e) => /Expected date: .*\(was .*\) – Bottle supplier is late/.test(e.note ?? '')), tl.body.map((e) => e.note));
  const pd = await call('PATCH', `/project-products/${prod.body.id}`, { token: admin, body: { targetDate: soon, promisedDate: later } });
  check('product line has its own dates', pd.status === 200 && pd.body.targetDate === soon && pd.body.promisedDate === later, pd.body);
  const custTry = await call('PATCH', `/project-products/${prod.body.id}`, { token: cust, body: { notes: 'from customer', promisedDate: '2030-01-01', targetDate: '2030-01-01' } });
  const [pp] = await q(`SELECT promised_date::text AS p, target_date::text AS t, notes FROM project_products WHERE id = $1`, [prod.body.id]);
  check('a customer cannot change dates (other edits still work)', custTry.status === 200 && pp.p === later && pp.t === soon && pp.notes === 'from customer', pp);
  check('…and the answer to the customer hides the target date', !('targetDate' in custTry.body));
  await q(`UPDATE projects SET promised_date = current_date - 2, target_date = current_date - 1 WHERE id = $1`, [projectId]);

  // ------------------------------------------------------------------ waiting on the customer
  section('Waiting on the customer');
  const quote = await call('POST', `/projects/${projectId}/quotes`, { token: admin, body: { currency: 'USD', lines: [{ description: 'Face cream 50 ml', quantity: 3000, unitPrice: 2.1 }] } });
  await call('POST', `/quotes/${quote.body.id}/send`, { token: admin });
  const sample = await call('POST', `/project-products/${prod.body.id}/samples`, { token: admin, body: { title: `Cream sample ${RUN}` } });
  const rev = await call('POST', `/samples/${sample.body.id}/revisions`, { token: admin, body: { description: 'First pass', shippedAt: new Date().toISOString(), trackingNo: 'TRK9' } });
  const sampleNow = await call('GET', `/samples/${sample.body.id}`, { token: admin });
  if (sampleNow.body.status !== 'shipped') await call('PATCH', `/samples/${sample.body.id}`, { token: admin, body: { status: 'shipped' } });
  const lead = await call('POST', '/inquiries', { body: {
    formType: 'contact', inquiryType: 'general', idempotencyKey: `smoke-${RUN}-lead`, elapsedMs: 30_000,
    contact: { firstName: 'Lena', lastName: 'Lead', email: `lead.${RUN}@${DOMAIN}` }, company: { name: `Smoke Test Lead Co ${RUN}` },
    message: 'We would like a body lotion.', sourcePage: '/contact/', consent: { privacy: true, policyVersion: '2026-10' },
  } });
  check('a website lead', lead.status === 201, lead.body);
  const ask = await call('POST', `/inquiries/${lead.body.id}/messages`, { token: admin, body: { body: 'Which fill size do you need?', askInfo: true } });
  check('staff ask the lead for information (waiting for customer)', ask.status === 201, ask.body);

  const mine = (rows) => rows.filter((r) => r.ref?.includes(prj.body.code) || r.ref === lead.body.referenceNo);
  let w = await call('GET', '/reminders', { token: salesToken });
  check('waiting list opens for staff', w.status === 200, w.body);
  check('customers cannot open it', (await call('GET', '/reminders', { token: cust })).status === 403);
  const waitC = mine(w.body.waitingOnCustomer);
  check('quote, sample and lead wait on the customer', ['quote', 'sample', 'inquiry'].every((t) => waitC.some((r) => r.type === t)), waitC.map((r) => r.type));
  const qItem = waitC.find((r) => r.type === 'quote');
  const sItem = waitC.find((r) => r.type === 'sample');
  const lItem = waitC.find((r) => r.type === 'inquiry');
  check('first reminder is planned 3 days after sending', qItem && Math.abs(new Date(qItem.nextAt) - Date.now() - 3 * 86_400_000) < 3_600_000, qItem);
  check('nothing sent yet', waitC.every((r) => r.sentCount === 0));

  // Every waiting item in this database must be ours before the daily job runs (it e-mails real customers).
  const foreign = w.body.waitingOnCustomer.filter((r) => !mine([r]).length);
  if (!check('only test items are waiting (safe to run the daily job)', foreign.length === 0, foreign)) throw new Error('real items are waiting – not running the daily job');

  const r0 = await call('POST', '/reminders/run', { token: admin });
  check('daily job: nothing due yet → no reminders', r0.status === 200 && r0.body.customerReminders === 0, r0.body);
  await q(`UPDATE reminder_states SET waiting_since = now() - interval '4 days' WHERE item_key = ANY($1)`, [[qItem.key, sItem.key, lItem.key]]);
  const r1 = await call('POST', '/reminders/run', { token: admin });
  check('after 3 days: one reminder each for quote, sample and lead', r1.body.customerReminders === 3, r1.body);
  const jobs = await q(`SELECT to_email, subject, body_text, project_id, inquiry_id FROM email_jobs WHERE template = 'customer_reminder' AND (project_id = $1 OR inquiry_id = $2)`, [projectId, lead.body.id]);
  check('reminder e-mails were written (quote, sample, lead)', jobs.length === 3, jobs.map((j) => j.subject));
  check('quote reminder goes to the customer login', jobs.some((j) => j.to_email === custEmail && /quote .* is waiting/i.test(j.subject)), jobs.map((j) => [j.to_email, j.subject]));
  check('lead reminder goes to the lead contact and repeats the question', jobs.some((j) => j.to_email === `lead.${RUN}@${DOMAIN}` && j.body_text.includes('Which fill size')));
  check('every reminder has a "stop reminder e-mails" link', jobs.every((j) => /Stop reminder e-mails: http\S+\/api\/reminders\/stop\?e=/.test(j.body_text)));
  const r2 = await call('POST', '/reminders/run', { token: admin });
  check('running again the same day sends nothing new', r2.body.customerReminders === 0, r2.body);
  await q(`UPDATE reminder_states SET last_sent_at = now() - interval '5 days' WHERE item_key = $1`, [qItem.key]);
  const r3 = await call('POST', '/reminders/run', { token: admin });
  check('second reminder after 4 more days', r3.body.customerReminders === 1, r3.body);
  await q(`UPDATE reminder_states SET last_sent_at = now() - interval '30 days' WHERE item_key = $1`, [qItem.key]);
  const r4 = await call('POST', '/reminders/run', { token: admin });
  check('stops after the limit of 2', r4.body.customerReminders === 0, r4.body);
  w = await call('GET', '/reminders', { token: admin });
  const q2 = w.body.waitingOnCustomer.find((r) => r.key === qItem.key);
  check('list shows 2 of 2 sent and no next reminder', q2.sentCount === 2 && q2.nextAt === null, q2);
  check('"Remind now" refuses past the limit', (await call('POST', '/reminders/send', { token: admin, body: { key: qItem.key } })).status === 400);

  section('Pause, remind now, settings');
  const p1 = await call('POST', '/reminders/pause', { token: salesToken, body: { key: sItem.key } });
  check('staff pause the sample reminders', p1.status === 200 && p1.body.waitingOnCustomer.find((r) => r.key === sItem.key).pausedAt);
  await q(`UPDATE reminder_states SET last_sent_at = now() - interval '30 days' WHERE item_key = $1`, [sItem.key]);
  const rp = await call('POST', '/reminders/run', { token: admin });
  const [sp] = await q(`SELECT sent_count FROM reminder_states WHERE item_key = $1`, [sItem.key]);
  check('a paused item gets no reminder, even when due', rp.body.customerReminders === 0 && sp.sent_count === 1, [rp.body, sp]);
  const p2 = await call('POST', '/reminders/resume', { token: salesToken, body: { key: sItem.key } });
  check('resume', p2.status === 200 && !p2.body.waitingOnCustomer.find((r) => r.key === sItem.key).pausedAt);
  const now1 = await call('POST', '/reminders/send', { token: salesToken, body: { key: sItem.key } });
  check('"Remind now" sends one at once', now1.status === 200 && now1.body.waitingOnCustomer.find((r) => r.key === sItem.key).sentCount === 2, now1.body.waitingOnCustomer?.find((r) => r.key === sItem.key));
  check('unknown item → 404', (await call('POST', '/reminders/send', { token: admin, body: { key: 'quote:nothing' } })).status === 404);
  check('settings: a wrong value is refused', (await call('PATCH', '/reminders/settings', { token: admin, body: { values: { 'reminders.customer.max': '99' } } })).status === 400);
  check('settings: only admins', (await call('PATCH', '/reminders/settings', { token: salesToken, body: { values: { 'reminders.customer.max': '3' } } })).status === 403);
  const set3 = await call('PATCH', '/reminders/settings', { token: admin, body: { values: { 'reminders.customer.max': '3' } } });
  check('settings: limit raised to 3', set3.status === 200 && set3.body.customer.max === 3);
  w = await call('GET', '/reminders', { token: admin });
  check('…so the quote has a next reminder again', !!w.body.waitingOnCustomer.find((r) => r.key === qItem.key).nextAt);
  await call('PATCH', '/reminders/settings', { token: admin, body: { values: { 'reminders.customer.max': null } } });

  section('Stop rules');
  const stopUrl = jobs.find((j) => j.to_email === custEmail).body_text.match(/Stop reminder e-mails: (\S+)/)[1];
  const stopPath = stopUrl.slice(stopUrl.indexOf('/api/') + 4);
  const page = await call('GET', stopPath);
  check('stop link opens a page with a button (opening it changes nothing)', page.status === 200 && /<form method="post"/.test(page.body));
  const [c0] = await q(`SELECT reminders_off_at FROM contacts WHERE id = $1`, [ct.body.id]);
  check('…not turned off just by opening it', c0.reminders_off_at === null);
  check('a changed link is refused', /not valid/.test((await call('GET', stopPath.replace(/t=.{4}/, 't=XXXX'))).body));
  const params = new URL(stopUrl).searchParams;
  const stopped = await call('POST', '/reminders/stop', { form: { e: params.get('e'), t: params.get('t') } });
  check('pressing the button turns reminders off', stopped.status === 200 && /Done/.test(stopped.body));
  const [c1] = await q(`SELECT reminders_off_at FROM contacts WHERE id = $1`, [ct.body.id]);
  check('…stored on the contact', c1.reminders_off_at !== null);
  w = await call('GET', '/reminders', { token: admin });
  const q3 = w.body.waitingOnCustomer.find((r) => r.key === sItem.key);
  check('…list shows the customer turned them off, no next reminder', q3.optedOut === 1 && q3.nextAt === null, q3);
  check('…"Remind now" refuses', (await call('POST', '/reminders/send', { token: admin, body: { key: sItem.key } })).status === 400);
  check('staff turn them back on when the customer asks', (await call('POST', `/contacts/${ct.body.id}/reminders-on`, { token: admin })).status === 200);
  const [c2] = await q(`SELECT reminders_off_at FROM contacts WHERE id = $1`, [ct.body.id]);
  check('…cleared', c2.reminders_off_at === null);

  const reply = await call('POST', `/projects/${projectId}/messages`, { token: cust, body: { body: 'We are checking the quote with our team.' } });
  check('the customer writes a message', reply.status === 201);
  w = await call('GET', '/reminders', { token: admin });
  check('a customer message stops the quote and sample reminders', !w.body.waitingOnCustomer.some((r) => r.projectId === projectId), mine(w.body.waitingOnCustomer));
  check('…the lead (another thread) still waits', w.body.waitingOnCustomer.some((r) => r.key === lItem.key));
  const ans = await call('PATCH', `/inquiries/${lead.body.id}/status`, { token: admin, body: { status: 'qualified' } });
  w = await call('GET', '/reminders', { token: admin });
  check('lead no longer waiting once its status changes', ans.status === 200 && !w.body.waitingOnCustomer.some((r) => r.key === lItem.key), ans.body);
  const [left] = await q(`SELECT count(*)::int AS n FROM reminder_states WHERE project_id = $1 OR inquiry_id = $2`, [projectId, lead.body.id]);
  check('their reminder rows are removed', left.n === 0, left);

  // ------------------------------------------------------------------ waiting on us
  section('Waiting on us');
  await q(`UPDATE messages SET created_at = now() - interval '30 hours' WHERE id = $1`, [reply.body.id]);
  await q(`UPDATE project_products SET promised_date = current_date + 5 WHERE id = $1`, [prod.body.id]);
  w = await call('GET', '/reminders', { token: salesToken });
  const us = w.body.waitingOnUs.filter((r) => r.projectId === projectId);
  check('unanswered customer message after 24 h', us.some((r) => r.type === 'unanswered_message' && r.owner === sales.email), us);
  check('promised date passed', us.some((r) => r.type === 'promised_passed'), us.map((r) => r.type));
  check('internal target date passed', us.some((r) => r.type === 'target_passed'));
  check('product line promised within 7 days', us.some((r) => r.type === 'promised_soon' && r.title.includes('Face cream')), us.map((r) => r.title));
  await call('POST', `/sample-revisions/${rev.body.id}/feedback`, { token: cust, body: { rating: 4, comments: 'Nice' } });
  w = await call('GET', '/reminders', { token: admin });
  check('sample feedback received → next step waits on us', w.body.waitingOnUs.some((r) => r.projectId === projectId && r.type === 'sample_feedback'));
  const foreignUs = w.body.waitingOnUs.filter((r) => r.projectId !== projectId && r.inquiryId !== lead.body.id);
  if (!check('only test items wait on us (safe to send the daily list)', foreignUs.length === 0, foreignUs)) return;
  const r5 = await call('POST', '/reminders/run', { token: admin });
  check('daily job sends the owner one "waiting on you" list', r5.body.staffDigests >= 1, r5.body);
  const [digest] = await q(`SELECT subject, body_text FROM email_jobs WHERE template = 'waiting_digest' AND to_email = $1 ORDER BY created_at DESC LIMIT 1`, [sales.email]);
  check('…listing the items', digest && /waiting on Despina/.test(digest.subject) && digest.body_text.includes(prj.body.code), digest);
  await call('POST', `/projects/${projectId}/messages`, { token: salesToken, body: { body: 'Thanks – take your time.' } });
  w = await call('GET', '/reminders', { token: admin });
  check('a staff reply clears the unanswered message', !w.body.waitingOnUs.some((r) => r.projectId === projectId && r.type === 'unanswered_message'));
  await call('PATCH', `/projects/${projectId}`, { token: admin, body: { status: 'on_hold', statusReason: 'Customer paused' } });
  w = await call('GET', '/reminders', { token: admin });
  check('a project on hold drops off both lists', !w.body.waitingOnUs.some((r) => r.projectId === projectId) && !w.body.waitingOnCustomer.some((r) => r.projectId === projectId));
}

try {
  await run();
} catch (e) {
  failures.push(`aborted: ${e.message}`);
  console.error(e);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✘ ${f}`);
if (ds) await ds.destroy();
if (!keep) {
  const r = spawnSync(process.execPath, ['scripts/smoke-test.mjs', '--cleanup'], { stdio: 'inherit', env: process.env });
  if (r.status) failures.push('cleanup failed');
}
process.exit(failures.length ? 1 : 0);

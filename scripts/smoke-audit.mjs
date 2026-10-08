// Audit-log test: every change is recorded once, with who / what / record / before-after / input,
// secrets are hidden, sign-in / sign-out and failed actions are not recorded, filters + export work.
//   npm run start:dev                      (other terminal)
//   npm run smoke:audit                    run + clean up        (-- --keep to keep the data)
// Uses ADMIN_EMAIL / ADMIN_PASSWORD; if they don't match the DB it creates a temporary admin (removed afterwards).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const API = process.env.SMOKE_API ?? `http://localhost:${process.env.PORT ?? 3000}/api`;
const DOMAIN = 'smoke-test.invalid';
const RUN = `a${Date.now().toString(36)}`;
const keep = process.argv.includes('--keep');
const started = new Date(Date.now() - 2000).toISOString();

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✔ ${name}`); }
  else { failures.push(`${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail).slice(0, 400)}`}`); console.log(`  ✘ ${name}`, detail ?? ''); }
  return ok;
}
const section = (t) => console.log(`\n▶ ${t}`);
async function call(method, path, { token, body } = {}) {
  const headers = { 'User-Agent': `smoke-audit/${RUN}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

let admin;
/** Newest audit rows matching a filter (since this run started). */
async function audit(filter = {}) {
  const r = await call('GET', `/audit-events?${new URLSearchParams({ from: started, pageSize: '100', ...filter })}`, { token: admin });
  return r.body.items ?? [];
}
const full = async (id) => (await call('GET', `/audit-events/${id}`, { token: admin })).body;
async function last(action, entityId) {
  const rows = await audit({ action, ...(entityId ? { entityId } : {}) });
  return rows[0] ? full(rows[0].id) : null;
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
  const me = (await call('GET', '/auth/me', { token: admin })).body;

  section('Sign-in / sign-out are not logged');
  check('no auth.login rows', (await audit({ q: 'auth.login' })).length === 0);
  const extra = await call('POST', '/auth/login', { body: { email: me.email, password: 'wrong-password-123' } });
  check('(failed login answered 401)', extra.status === 401);

  section('Website visitor sends a form');
  const sub = await call('POST', '/inquiries', { body: {
    formType: 'contact', inquiryType: 'general', idempotencyKey: `smoke-${RUN}-c`, sourcePage: '/contact/',
    contact: { firstName: 'Audit', lastName: 'Visitor', email: `visitor.${RUN}@${DOMAIN}` }, company: { name: `Smoke Test Audit ${RUN}` },
    message: 'Audit test', consent: { privacy: true }, hp: undefined,
  } });
  check('form sent', sub.status === 201, sub.body);
  const s = await last('inquiry.submit', sub.body.id);
  check('row: inquiry.submit, no account (actor empty)', s?.actorId === null && s?.actorEmail === null, s);
  check('summary names the visitor + reference', s?.summary?.includes(`Website visitor (visitor.${RUN}@${DOMAIN})`) && s?.summary?.includes(sub.body.referenceNo), s?.summary);
  check('record = the inquiry, label = reference, lead + company linked', s?.entityType === 'inquiry' && s?.entityLabel === sub.body.referenceNo && s?.inquiryId === sub.body.id && !!s?.companyId);
  check('after = the stored inquiry row', s?.after?.reference_no === sub.body.referenceNo);
  check('input = what was sent', s?.details?.input?.contact?.email === `visitor.${RUN}@${DOMAIN}`);
  check('IP, browser, method and path stored', !!s?.ip && s?.userAgent === `smoke-audit/${RUN}` && s?.method === 'POST' && s?.path === '/api/inquiries' && s?.statusCode === 201, s);
  const inquiryId = sub.body.id;

  section('Staff work on the lead');
  const st = await call('PATCH', `/inquiries/${inquiryId}/status`, { token: admin, body: { status: 'qualified', note: 'good fit' } });
  check('status changed', st.status === 200);
  const sr = await last('inquiry.status', inquiryId);
  check('row has the admin as actor (email + role)', sr?.actorId === me.id && sr?.actorEmail === me.email && sr?.actorRole === 'admin', sr);
  check('changes: status new → qualified', sr?.details?.changes?.some((c) => c.field === 'status' && c.from === 'new' && c.to === 'qualified'), sr?.details?.changes);
  check('summary readable', sr?.summary === `${me.email} changed the status of ${sub.body.referenceNo} to qualified`, sr?.summary);
  const bad = await call('PATCH', `/inquiries/${inquiryId}/status`, { token: admin, body: { status: 'banana' } });
  check('(invalid status → 400)', bad.status === 400);
  check('failed action is not logged', (await audit({ action: 'inquiry.status', entityId: inquiryId })).length === 1);
  await call('POST', `/inquiries/${inquiryId}/notes`, { token: admin, body: { note: `Called ${RUN}` } });
  check('internal note logged with its text', (await last('inquiry.note', inquiryId))?.summary?.includes(`Called ${RUN}`));
  await call('POST', `/inquiries/${inquiryId}/assign`, { token: admin, body: { userId: me.id } });
  check('assignment logged with the assignee e-mail', (await last('inquiry.assign', inquiryId))?.summary?.endsWith(`to ${me.email}`));

  section('Tasks: create, update, complete, reopen, delete');
  const t = await call('POST', '/tasks', { token: admin, body: { title: `Audit task ${RUN}`, inquiryId, priority: 'high' } });
  const tc = await last('task.create', t.body.id);
  check('task.create with the new row', tc?.after?.title === `Audit task ${RUN}` && tc?.before === null && tc?.inquiryId === inquiryId, tc);
  await call('PATCH', `/tasks/${t.body.id}`, { token: admin, body: { title: `Audit task ${RUN} v2` } });
  const tu = await last('task.update', t.body.id);
  check('task.update: before/after + title change', tu?.before?.title === `Audit task ${RUN}` && tu?.after?.title === `Audit task ${RUN} v2`
    && tu?.details?.changes?.some((c) => c.field === 'title'), tu?.details?.changes);
  await call('POST', `/tasks/${t.body.id}/complete`, { token: admin });
  const tdone = await last('task.complete', t.body.id);
  check('task.complete: completed_at empty → set', tdone?.details?.changes?.some((c) => c.field === 'completed_at' && c.from === null && c.to), tdone?.details?.changes);
  await call('POST', `/tasks/${t.body.id}/reopen`, { token: admin });
  check('task.reopen logged', !!(await last('task.reopen', t.body.id)));
  await call('DELETE', `/tasks/${t.body.id}`, { token: admin });
  const td = await last('task.delete', t.body.id);
  check('task.delete keeps the deleted row in "before"', td?.before?.title === `Audit task ${RUN} v2` && td?.after === null, td);

  section('Invite a customer (secrets hidden), customer actions');
  const lead = (await call('GET', `/inquiries/${inquiryId}`, { token: admin })).body;
  const inv = await call('POST', '/users/invite', { token: admin, body: { email: `buyer.${RUN}@${DOMAIN}`, role: 'customer', companyId: lead.companyId } });
  check('invite sent', inv.status === 201, inv.body);
  const ui = await last('user.invite');
  check('user.invite logged: "invited … as customer"', ui?.summary === `${me.email} invited buyer.${RUN}@${DOMAIN} as customer`, ui?.summary);
  const pwd = `Smoke-${RUN}-Passw0rd!`;
  await call('POST', '/auth/accept-invite', { body: { token: inv.body.inviteToken, password: pwd } });
  const ai = await last('auth.accept_invite');
  check('accept-invite logged with the new user as actor', ai?.actorEmail === `buyer.${RUN}@${DOMAIN}` && ai?.actorRole === 'customer', ai);
  check('invite token and password hidden in the input', ai?.details?.input?.token === '[hidden]' && ai?.details?.input?.password === '[hidden]', ai?.details?.input);
  const allText = JSON.stringify([ui, ai]);
  check('no secret value anywhere in the rows', !allText.includes(inv.body.inviteToken) && !allText.includes(pwd) && !/"password_hash":"\$2/.test(allText));
  const cl = await call('POST', '/auth/login', { body: { email: `buyer.${RUN}@${DOMAIN}`, password: pwd } });
  const cust = cl.body.token;
  const pc = await call('POST', '/auth/password/change', { token: cust, body: { currentPassword: pwd, newPassword: `${pwd}2` } });
  check('(customer changed password)', pc.status === 200 || pc.status === 201, pc.body);
  const pcr = await last('auth.password_change');
  check('password change logged, both passwords hidden', pcr?.actorEmail === `buyer.${RUN}@${DOMAIN}` && pcr?.details?.input?.currentPassword === '[hidden]' && pcr?.details?.input?.newPassword === '[hidden]', pcr?.details?.input);
  await call('POST', '/auth/logout', { token: cust });
  check('logout not logged', (await audit({ q: 'logout' })).length === 0);
  check('customer cannot read the audit log (403)', (await call('GET', '/audit-events', { token: (await call('POST', '/auth/login', { body: { email: `buyer.${RUN}@${DOMAIN}`, password: `${pwd}2` } })).body.token })).status === 403);

  section('Project actions are linked to the project');
  const conv = await call('POST', `/inquiries/${inquiryId}/convert`, { token: admin, body: {} });
  const project = conv.body;
  const cv = await last('inquiry.convert', inquiryId);
  check('convert logged: "converted … into project DP-PRJ-…"', cv?.summary?.includes(`into project ${project.code}`), cv?.summary);
  const prod = await call('POST', `/projects/${project.id}/products`, { token: admin, body: { name: `Audit product ${RUN}` } });
  check('product.add logged against the project', (await last('product.add', prod.body.id))?.projectId === project.id);
  const stage = project.stages[0];
  await call('POST', `/projects/${project.id}/stages/${stage.id}/complete`, { token: admin, body: {} });
  const sc = await last('stage.complete', stage.id);
  check('stage.complete: label = stage name, linked to project', sc?.entityLabel === stage.name && sc?.projectId === project.id, sc);
  const q = await call('POST', `/projects/${project.id}/quotes`, { token: admin, body: { lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] } });
  await call('POST', `/quotes/${q.body.id}/send`, { token: admin });
  const qs = await last('quote.send', q.body.id);
  check('quote.send: status draft → sent', qs?.details?.changes?.some((c) => c.field === 'status' && c.from === 'draft' && c.to === 'sent'), qs?.details?.changes);

  section('Filters, details, export');
  const byProject = await audit({ projectId: project.id });
  check('?projectId → product, stage, quote rows', ['product.add', 'stage.complete', 'quote.create', 'quote.send'].every((a) => byProject.some((r) => r.action === a)), byProject.map((r) => r.action));
  const byLead = await audit({ inquiryId });
  check('?inquiryId → the whole lead history incl. tasks', ['inquiry.submit', 'inquiry.status', 'inquiry.note', 'inquiry.assign', 'task.create', 'task.delete', 'inquiry.convert'].every((a) => byLead.some((r) => r.action === a)), byLead.map((r) => r.action));
  const byActor = await audit({ actorId: me.id });
  check('?actorId → only that user', byActor.length > 0 && byActor.every((r) => r.actorId === me.id));
  check('?action=task. (prefix) → only task actions', (await audit({ action: 'task.' })).every((r) => r.action.startsWith('task.')));
  check('?visitors=true → only rows without account', (await audit({ visitors: 'true' })).every((r) => r.actorId === null));
  check('?q= searches the summary', (await audit({ q: `Called ${RUN}` })).length === 1);
  check('list leaves out the heavy JSON (before/after)', byLead[0] && !('before' in byLead[0]));
  check('GET requests are not logged', (await audit({ q: 'GET ' })).length === 0 && byLead.every((r) => r.method !== 'GET'));
  const filters = await call('GET', '/audit-events/filters', { token: admin });
  check('filters: record types, actions, people', filters.body.entityTypes?.includes('task') && filters.body.actions?.includes('task.complete') && filters.body.actors?.some((a) => a.id === me.id));
  const csv = await call('GET', `/audit-events/export.csv?inquiryId=${inquiryId}`, { token: admin });
  check('CSV export with changes column', typeof csv.body === 'string' && csv.body.includes('time_utc,user,role,action,summary') && csv.body.includes('status: ""new"" → ""qualified""'));
  check('one row per action (no duplicates for inquiry.status)', (await audit({ action: 'inquiry.status', entityId: inquiryId })).length === 1);
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
  spawnSync(process.execPath, ['scripts/smoke-test.mjs', '--cleanup'], { stdio: 'inherit', env: process.env });
  spawnSync(process.execPath, ['scripts/qa-admin.mjs', 'remove'], { stdio: 'inherit', env: process.env });
}
process.exit(failures.length ? 1 : 0);

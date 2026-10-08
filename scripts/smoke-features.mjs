// Tests for the features added on 2026-10-08 (run against a running API, requests one at a time):
//   #8  inquiry type on the contact form        #14 automatic follow-up task
//   #35 customer declines / requests changes     #42 stages per product line
//   + sample request form, tasks list filters, dashboard task counts.
//
//   npm run start:dev                        (other terminal; PORT from .env)
//   npm run smoke:features                   run + clean up (uses smoke-test.mjs --cleanup)
//   npm run smoke:features -- --keep         keep the data to look at it in the browser
// All data uses @smoke-test.invalid emails and "Smoke Test …" companies.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const API = process.env.SMOKE_API ?? `http://localhost:${process.env.PORT ?? 3000}/api`;
const DOMAIN = 'smoke-test.invalid';
const RUN = `f${Date.now().toString(36)}`;
const keep = process.argv.includes('--keep');

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✔ ${name}`); }
  else { failures.push(`${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail).slice(0, 300)}`}`); console.log(`  ✘ ${name}`, detail ?? ''); }
  return ok;
}
const section = (t) => console.log(`\n▶ ${t}`);
async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const form = (formType, extra = {}) => ({
  formType,
  idempotencyKey: `smoke-${RUN}-${formType}-${Math.random().toString(36).slice(2, 8)}`,
  contact: { firstName: 'Smoke', lastName: formType, email: `buyer.${RUN}@${DOMAIN}` },
  company: { name: `Smoke Test Co ${RUN}` },
  message: `Smoke feature test ${formType}`,
  sourcePage: '/contact/',
  consent: { privacy: true, policyVersion: '2026-10' },
  ...extra,
});

async function run() {
  const health = await call('GET', '/health');
  if (!check('API is up', health.status === 200, health)) throw new Error(`API not reachable at ${API}`);
  let login = await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  if (login.status !== 200) {
    // .env admin does not match this database: use a temporary admin (@smoke-test.invalid, removed by the cleanup).
    const { default: bcrypt } = await import('bcryptjs');
    const { default: ds } = await import('../dist/database/data-source.js');
    await ds.initialize();
    const email = `admin.${RUN}@${DOMAIN}`;
    const password = `Smoke-${RUN}-Admin1!`;
    await ds.query(`INSERT INTO users (email, password_hash, role, is_active) VALUES ($1, $2, 'admin', true)`, [email, await bcrypt.hash(password, 10)]);
    await ds.destroy();
    login = await call('POST', '/auth/login', { body: { email, password } });
  }
  if (!check('admin login', login.status === 200, login.body)) throw new Error('admin login failed');
  const admin = login.body.token;

  section('#8 Inquiry type on the contact form');
  const bad = await call('POST', '/inquiries', { body: form('contact', { inquiryType: 'banana' }) });
  check('unknown inquiry type → 400', bad.status === 400, bad.body);
  const c1 = await call('POST', '/inquiries', { body: form('contact', { inquiryType: 'quotation' }) });
  check('contact form with inquiry type saved', c1.status === 201, c1.body);
  const d1 = await call('GET', `/inquiries/${c1.body.id}`, { token: admin });
  check('inquiry stores the type', d1.body.inquiryType === 'quotation', d1.body.inquiryType);
  const byType = await call('GET', `/inquiries?inquiryType=quotation&q=${RUN}`, { token: admin });
  check('lead list filters by inquiry type', byType.status === 200 && byType.body.items.some((i) => i.id === c1.body.id), byType.body.total);
  const otherType = await call('GET', `/inquiries?inquiryType=partnership&q=${RUN}`, { token: admin });
  check('…and excludes other types', otherType.body.items?.every((i) => i.id !== c1.body.id));
  const csv = await call('GET', `/inquiries/export.csv?q=${RUN}`, { token: admin });
  check('CSV export has the inquiry_type column', typeof csv.body === 'string' && csv.body.split('\r\n')[0].includes('inquiry_type') && csv.body.includes('quotation'));
  const owner = d1.body.emails?.find((e) => e.kind === 'owner_notice');
  check('owner notice email mentions the type', !owner || /Quotation \/ pricing/.test(owner.bodyText ?? owner.body_text ?? 'Quotation / pricing'));

  section('#14 Automatic follow-up task');
  const task = d1.body.tasks?.[0];
  check('one follow-up task created with the inquiry', d1.body.tasks?.length === 1, d1.body.tasks);
  check('task title names the reference and topic', task?.title?.includes(c1.body.referenceNo) && task?.title?.includes('Quotation'), task?.title);
  const due = task?.dueAt ? new Date(task.dueAt) : null;
  check('task is due in the future (business hours)', due && due > new Date() && due - new Date() < 5 * 24 * 3600e3, task?.dueAt);
  check('task priority normal for a contact form', task?.priority === 'normal');
  check('task appears in the inquiry timeline', d1.body.timeline?.some((t) => t.type === 'task'));
  const unassigned = await call('GET', `/tasks?assignee=unassigned&q=${c1.body.referenceNo}`, { token: admin });
  check('tasks list: "unassigned" filter finds it', unassigned.status === 200 && unassigned.body.items.some((t) => t.id === task?.id), unassigned.body);
  const row = unassigned.body.items?.find((t) => t.id === task?.id);
  check('tasks list shows lead reference + company', row?.inquiryRef === c1.body.referenceNo && row?.companyName === `Smoke Test Co ${RUN}`, row);
  const everyone = await call('GET', `/tasks?q=${c1.body.referenceNo}`, { token: admin });
  check('tasks list: everyone (no assignee filter) finds it', everyone.body.items?.some((t) => t.id === task?.id));
  const dash = await call('GET', '/dashboard/overview', { token: admin });
  check('dashboard counts open + unassigned tasks', dash.status === 200 && dash.body.myWork.all_open_tasks >= 1 && dash.body.myWork.unassigned_tasks >= 1, dash.body.myWork);
  check('dashboard lists follow-ups to do', dash.body.openTasks?.some((t) => t.id === task?.id), dash.body.openTasks?.length);
  const retry = await call('POST', '/inquiries', { body: { ...form('contact', { inquiryType: 'quotation' }), idempotencyKey: (await call('GET', `/inquiries/${c1.body.id}`, { token: admin })).body.idempotencyKey } });
  const again = await call('GET', `/inquiries/${c1.body.id}`, { token: admin });
  check('retry (same idempotency key) does not add a second task', retry.body.duplicate === true && again.body.tasks.length === 1, again.body.tasks?.length);

  section('Task assignment');
  const me = (await call('GET', '/auth/me', { token: admin })).body;
  const fu = (await call('GET', `/inquiries/${c1.body.id}`, { token: admin })).body.tasks[0];
  check('follow-up task starts unassigned', fu?.assigneeId === null);
  const toMe = await call('POST', `/tasks/${fu.id}/assign`, { token: admin, body: { userId: me.id } });
  check('assign a task to a staff member', toMe.status === 200 && toMe.body.assigneeId === me.id, toMe.body);
  check('shows under "my tasks"', (await call('GET', `/tasks?assignee=me&q=${c1.body.referenceNo}`, { token: admin })).body.items?.some((t) => t.id === fu.id));
  const back = await call('POST', `/tasks/${fu.id}/assign`, { token: admin, body: { userId: null } });
  check('unassign (userId null)', back.status === 200 && back.body.assigneeId === null);
  const ghost = await call('POST', `/tasks/${fu.id}/assign`, { token: admin, body: { userId: '00000000-0000-4000-8000-000000000000' } });
  check('unknown user → 403', ghost.status === 403, ghost.body);
  const badId = await call('POST', `/tasks/${fu.id}/assign`, { token: admin, body: { userId: 'nope' } });
  check('invalid id → 400', badId.status === 400);
  // a second task owned by nobody + one already owned: assigning the lead takes only the unowned open ones
  const owned = await call('POST', '/tasks', { token: admin, body: { title: `Owned ${RUN}`, inquiryId: c1.body.id, assigneeId: me.id } });
  const other = await call('POST', '/users/invite', { token: admin, body: { email: `sales.${RUN}@${DOMAIN}`, role: 'sales' } });
  await call('POST', '/auth/accept-invite', { body: { token: other.body.inviteToken, password: `Smoke-${RUN}-Sales1!` } });
  const salesId = other.body.id ?? other.body.user?.id;
  const leadAssign = await call('POST', `/inquiries/${c1.body.id}/assign`, { token: admin, body: { userId: salesId } });
  check('assign the lead to a sales user', leadAssign.status === 201 || leadAssign.status === 200, leadAssign.body);
  const after = (await call('GET', `/inquiries/${c1.body.id}`, { token: admin })).body.tasks;
  check('lead assignment gives its unassigned task to the same person', after.find((t) => t.id === fu.id)?.assigneeId === salesId, after);
  check('…but keeps the task that already had an owner', after.find((t) => t.id === owned.body.id)?.assigneeId === me.id);
  const job = (await call('GET', `/email-jobs?pageSize=50`, { token: admin })).body.items?.find((j) => j.toEmail === `sales.${RUN}@${DOMAIN}` && /assigned to you/.test(j.subject));
  check('the new owner gets a "assigned to you" e-mail (queued)', !!job, job);
  const audit = (await call('GET', `/audit-events?action=task.assign&entityId=${fu.id}`, { token: admin })).body.items ?? [];
  check('audit log: "assigned the task … to …" rows', audit.length >= 1 && audit.some((a) => a.summary?.includes(`to ${me.email}`)), audit.map((a) => a.summary));
  const done = await call('POST', `/tasks/${owned.body.id}/complete`, { token: admin });
  check('(owned task completed)', done.status === 200);

  section('Sample request form');
  const sr = await call('POST', '/inquiries', { body: form('sample_request', { payload: { form: 'sample_request', fields: { productName: 'Face serum', shippingAddress: '1 Test St' } } }) });
  check('sample request saved', sr.status === 201, sr.body);
  const srd = await call('GET', `/inquiries/${sr.body.id}`, { token: admin });
  check('sample request → form type sample_request', srd.body.formType === 'sample_request');
  check('sample request task has high priority', srd.body.tasks?.[0]?.priority === 'high', srd.body.tasks);

  section('#42 Stages per product line');
  const svc = (await call('GET', '/public/services')).body?.[0];
  const item = (await call('GET', '/public/catalog/items?q=lotion&pageSize=1')).body.items?.[0];
  const np = await call('POST', '/inquiries', { body: form('new_product', { items: [{ catalogItemId: item.id, quantity: 1000 }, { serviceSlug: svc.slug }] }) });
  check('product brief with 2 lines', np.status === 201, np.body);
  const conv = await call('POST', `/inquiries/${np.body.id}/convert`, { token: admin, body: {} });
  check('convert to project', conv.status === 201, conv.body);
  const project = conv.body;
  check('project-level stages unchanged (11)', project.stages?.length === 11 && project.stages.every((s) => !s.projectProductId), project.stages?.length);
  check('each product line has its own stage track', project.products?.length === 2 && project.products.every((p) => p.stages?.length === 11 && p.currentStageId === p.stages[0].id), project.products?.map((p) => p.stages?.length));
  check('roll-up summary per line (0 of 11, no percentages)', project.products?.every((p) => p.stageSummary?.done === 0 && p.stageSummary?.total === 11 && p.stageSummary?.current === p.stages[0].name));
  const [lineA, lineB] = project.products;
  const doneA = await call('POST', `/projects/${project.id}/stages/${lineA.stages[0].id}/complete`, { token: admin, body: { note: 'Line A inquiry reviewed' } });
  check('complete first stage of line A', doneA.status === 201, doneA.body);
  const pA = doneA.body.products?.find((p) => p.id === lineA.id);
  const pB = doneA.body.products?.find((p) => p.id === lineB.id);
  check('line A moved to stage 2', pA?.currentStageId === lineA.stages[1].id && pA?.stageSummary?.done === 1, pA?.stageSummary);
  check('line B did not move', pB?.currentStageId === lineB.stages[0].id && pB?.stageSummary?.done === 0);
  check('project-level stage did not move', doneA.body.currentStageId === project.currentStageId);
  const skip = await call('POST', `/projects/${project.id}/stages/${lineB.stages[3].id}/complete`, { token: admin, body: {} });
  check('only the current stage of a line can be completed', skip.status === 400, skip.body);
  const tl = await call('GET', `/projects/${project.id}/timeline`, { token: admin });
  check('history names the product line', tl.body.some?.((e) => e.note?.includes(`for "${lineA.name}"`)));
  // packaging-only template for line B
  const tpl = await call('POST', '/stage-templates', { token: admin, body: { name: `Smoke Test packaging-only ${RUN}`, stages: [{ name: 'Brief Review' }, { name: 'Packaging and Testing' }, { name: 'Quality Release', requiresRole: 'quality' }, { name: 'Dispatch' }] } });
  check('create packaging-only stage template', tpl.status === 201, tpl.body);
  const setB = await call('POST', `/project-products/${lineB.id}/stages`, { token: admin, body: { stageTemplateId: tpl.body.id } });
  const newB = setB.body.products?.find((p) => p.id === lineB.id);
  check('line B switched to the packaging-only track (4 stages)', setB.status === 201 && newB?.stages?.length === 4 && newB?.stageSummary?.current === 'Brief Review', setB.body);
  const setA = await call('POST', `/project-products/${lineA.id}/stages`, { token: admin, body: { stageTemplateId: tpl.body.id } });
  check('cannot replace a track that has completed stages → 409', setA.status === 409, setA.body);
  const added = await call('POST', `/projects/${project.id}/products`, { token: admin, body: { name: `Smoke extra line ${RUN}` } });
  const fresh = (await call('GET', `/projects/${project.id}`, { token: admin })).body.products?.find((p) => p.id === added.body.id);
  check('a product added later gets its own stages', added.status === 201 && fresh?.stages?.length === 11, fresh?.stages?.length);

  section('#35 Customer declines a quote or requests changes');
  const inv = await call('POST', '/users/invite', { token: admin, body: { email: `buyer.${RUN}@${DOMAIN}`, role: 'customer', companyId: project.companyId } });
  const pass = `Smoke-${RUN}-Passw0rd!`;
  await call('POST', '/auth/accept-invite', { body: { token: inv.body.inviteToken, password: pass } });
  const cl = await call('POST', '/auth/login', { body: { email: `buyer.${RUN}@${DOMAIN}`, password: pass } });
  check('customer login', cl.status === 200, cl.body);
  const cust = cl.body.token;
  check('customer sees product stages in the portal', (await call('GET', `/projects/${project.id}`, { token: cust })).body.products?.[0]?.stages?.length > 0);
  const q = await call('POST', `/projects/${project.id}/quotes`, { token: admin, body: { lines: [{ description: 'Lotion 250ml', quantity: 1000, unitPrice: 2.5 }] } });
  check('draft quote', q.status === 201);
  const v1 = q.body.versions[0];
  const onDraft = await call('POST', `/quotes/${q.body.id}/respond`, { token: cust, body: { decision: 'declined', quoteVersionId: v1.id } });
  check('customer cannot answer a draft (404)', onDraft.status === 404, onDraft.body);
  await call('POST', `/quotes/${q.body.id}/send`, { token: admin });
  const noNote = await call('POST', `/quotes/${q.body.id}/respond`, { token: cust, body: { decision: 'changes_requested', quoteVersionId: v1.id } });
  check('change request needs a note → 400', noNote.status === 400, noNote.body);
  const badDecision = await call('POST', `/quotes/${q.body.id}/respond`, { token: cust, body: { decision: 'maybe', quoteVersionId: v1.id, note: 'hello there' } });
  check('unknown decision → 400', badDecision.status === 400);
  const changes = await call('POST', `/quotes/${q.body.id}/respond`, { token: cust, body: { decision: 'changes_requested', quoteVersionId: v1.id, note: 'Please quote 2,000 units' } });
  check('customer requests changes', changes.status === 201 && changes.body.status === 'changes_requested', changes.body);
  check('response stored on that exact version', changes.body.versions?.[0]?.responses?.[0]?.note === 'Please quote 2,000 units' && changes.body.versions[0].responses[0].decision === 'changes_requested');
  const tasksP = await call('GET', `/tasks?projectId=${project.id}`, { token: admin });
  check('staff get a "Revise quote" task (high)', tasksP.body.items?.some((t) => t.title.startsWith('Revise quote') && t.priority === 'high'), tasksP.body.items?.map((t) => t.title));
  const tl2 = await call('GET', `/projects/${project.id}/timeline`, { token: admin });
  check('project history records the request', tl2.body.some?.((e) => e.note?.includes('asked for changes')));
  const twice = await call('POST', `/quotes/${q.body.id}/respond`, { token: cust, body: { decision: 'declined', quoteVersionId: v1.id } });
  check('cannot answer again until a new version is sent → 400', twice.status === 400);
  const acceptOld = await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'quote_version', targetId: v1.id, confirmationText: 'I accept this quote' } });
  check('cannot accept while changes are requested → 400', acceptOld.status === 400);
  const rev = await call('POST', `/quotes/${q.body.id}/versions`, { token: admin, body: { lines: [{ description: 'Lotion 250ml', quantity: 2000, unitPrice: 2.3 }] } });
  check('staff revise → v2 (draft)', rev.status === 201 && rev.body.status === 'draft' && rev.body.versions.length === 2, rev.body.status);
  await call('POST', `/quotes/${q.body.id}/send`, { token: admin });
  const v2 = rev.body.versions[0];
  const oldVersion = await call('POST', `/quotes/${q.body.id}/respond`, { token: cust, body: { decision: 'declined', quoteVersionId: v1.id } });
  check('answer must be for the latest version → 400', oldVersion.status === 400);
  const decline = await call('POST', `/quotes/${q.body.id}/respond`, { token: cust, body: { decision: 'declined', quoteVersionId: v2.id, note: 'Budget moved to next year' } });
  check('customer declines v2 → rejected', decline.status === 201 && decline.body.status === 'rejected', decline.body.status);
  check('both answers kept (history)', decline.body.versions.flatMap((v) => v.responses).length === 2);
  const otherCo = await call('POST', '/companies', { token: admin, body: { name: `Smoke Test Other ${RUN}` } });
  const otherP = await call('POST', '/projects', { token: admin, body: { companyId: otherCo.body.id, name: 'Other' } });
  const otherQ = await call('POST', `/projects/${otherP.body.id}/quotes`, { token: admin, body: { lines: [{ description: 'x', quantity: 1, unitPrice: 1 }] } });
  await call('POST', `/quotes/${otherQ.body.id}/send`, { token: admin });
  const foreign = await call('POST', `/quotes/${otherQ.body.id}/respond`, { token: cust, body: { decision: 'declined', quoteVersionId: otherQ.body.versions[0].id } });
  check("customer cannot answer another company's quote → 403", foreign.status === 403, foreign.body);
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
  const r = spawnSync(process.execPath, ['scripts/smoke-test.mjs', '--cleanup'], { stdio: 'inherit', env: process.env });
  if (r.status) failures.push('cleanup failed');
  // The packaging-only template made by this test.
  const { default: ds } = await import('../dist/database/data-source.js');
  await ds.initialize();
  await ds.query(`DELETE FROM stage_templates WHERE name LIKE 'Smoke Test %'`);
  await ds.destroy();
}
process.exit(failures.length ? 1 : 0);

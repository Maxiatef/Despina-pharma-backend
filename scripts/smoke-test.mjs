// End-to-end smoke test against a running local API.
//   npm run start:dev   (other terminal)
//   node scripts/smoke-test.mjs            run + clean up
//   node scripts/smoke-test.mjs --keep     run, keep the test data
//   node scripts/smoke-test.mjs --cleanup  only delete old smoke-test data
// All test data uses emails @smoke-test.invalid and companies named "Smoke Test ...".
import 'dotenv/config';
import { readdir, rm } from 'node:fs/promises';
import ds from '../dist/database/data-source.js';

const API = process.env.SMOKE_API ?? `http://localhost:${process.env.PORT ?? 3000}/api`;
const DOMAIN = 'smoke-test.invalid';
const RUN = Date.now().toString(36);
const args = new Set(process.argv.slice(2));

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✔ ${name}`); }
  else { failures.push(`${name}${detail ? ` → ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`); console.log(`  ✘ ${name}`, detail ?? ''); }
  return ok;
}
const section = (t) => console.log(`\n▶ ${t}`);

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

// Minimal valid PDF
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function upload(token, opts = {}) {
  const init = await call('POST', '/uploads/initiate', {
    token, body: { filename: 'spec-sheet.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length, ...opts },
  });
  if (init.status !== 201) return { init };
  const put = await call('PUT', `/uploads/${init.body.documentId}/content`, {
    token, raw: PDF,
    headers: { 'Content-Type': 'application/pdf', 'X-Upload-Token': init.body.uploadToken, 'X-Filename': 'spec-sheet.pdf' },
  });
  const done = await call('POST', '/uploads/complete', { body: { documentId: init.body.documentId, token: init.body.uploadToken } });
  return { init, put, done, ref: { documentId: init.body.documentId, token: init.body.uploadToken } };
}

function form(formType, extra = {}) {
  return {
    formType,
    idempotencyKey: `smoke-${RUN}-${formType}-${Math.random().toString(36).slice(2, 8)}`,
    contact: { firstName: 'Smoke', lastName: formType, email: `buyer.${RUN}@${DOMAIN}`, phone: '+1 555 0100' },
    company: { name: `Smoke Test Co ${RUN}`, website: 'example.com', country: 'US' },
    message: `Smoke test ${formType}`,
    sourcePage: '/contact/',
    consent: { privacy: true, marketing: true, policyVersion: '2026-10' },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
async function run() {
  section('Health & public website reads');
  const health = await call('GET', '/health');
  if (!check('API is up', health.status === 200, health)) throw new Error(`API not reachable at ${API} – start it with npm run start:dev`);
  const cats = await call('GET', '/public/catalog/categories');
  check('14 categories with item counts', cats.status === 200 && cats.body.length === 14 && cats.body.every((c) => c.itemCount >= 0), cats.body?.length);
  const skincare = await call('GET', '/public/catalog/categories/skincare');
  check('category detail + subgroups', skincare.status === 200 && skincare.body.subgroups?.length > 0);
  const search = await call('GET', '/public/catalog/items?q=lotion&category=skincare&pageSize=5&sort=name');
  check('catalog search/filter/paginate', search.status === 200 && search.body.items.length > 0 && search.body.total > 0, search.body);
  const item = search.body.items?.[0];
  const bySlug = await call('GET', `/public/catalog/categories/skincare/items/${item?.slug}`);
  check('item by category/slug', bySlug.status === 200 && bySlug.body.id === item?.id);
  const services = await call('GET', '/public/services');
  check('16 services', services.status === 200 && services.body.length === 16, services.body?.length);
  const svc = await call('GET', '/public/services/private-label');
  check('service by slug', svc.status === 200 && svc.body.slug === 'private-label');
  check('missing service → 404', (await call('GET', '/public/services/nope')).status === 404);

  section('Public uploads');
  const up = await upload();
  check('initiate upload', up.init.status === 201, up.init.body);
  check('send file bytes', up.put?.status === 200 && up.put.body.sha256?.length === 64, up.put?.body);
  check('complete upload', up.done?.status === 200, up.done?.body);
  const badType = await call('POST', '/uploads/initiate', { body: { filename: 'x.exe', mimeType: 'application/octet-stream', sizeBytes: 10 } });
  check('reject .exe', badType.status === 400);
  const tooBig = await call('POST', '/uploads/initiate', { body: { filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 50 * 1024 * 1024 } });
  check('reject > 10 MB', tooBig.status === 413, tooBig.status);
  const fake = await call('POST', '/uploads/initiate', { body: { filename: 'fake.pdf', mimeType: 'application/pdf', sizeBytes: 5 } });
  const fakePut = await call('PUT', `/uploads/${fake.body.documentId}/content`, {
    raw: Buffer.from('hello'), headers: { 'Content-Type': 'application/pdf', 'X-Upload-Token': fake.body.uploadToken, 'X-Filename': 'fake.pdf' },
  });
  check('reject file whose content is not really a PDF', fakePut.status === 400, fakePut.body);
  const badToken = await call('PUT', `/uploads/${fake.body.documentId}/content`, {
    raw: PDF, headers: { 'Content-Type': 'application/pdf', 'X-Upload-Token': 'wrong', 'X-Filename': 'x.pdf' },
  });
  check('reject wrong upload token', badToken.status === 403);

  section('Public forms (all 6)');
  const main = form('new_product', {
    items: [{ catalogPath: `skincare/${item.slug}`, quantity: 5000, notes: 'Unscented' }, { serviceSlug: 'packaging' }],
    uploads: [up.ref],
    payload: { targetLaunch: '2027-Q1', budget: '10-25k' },
  });
  const r1 = await call('POST', '/inquiries', { body: main });
  check('new product inquiry saved with reference', r1.status === 201 && /^DP-INQ-\d{4}-\d{6}$/.test(r1.body.referenceNo), r1.body);
  const r1again = await call('POST', '/inquiries', { body: main });
  check('same idempotency key → same inquiry (no duplicate)', r1again.body.referenceNo === r1.body.referenceNo && r1again.body.duplicate === true, r1again.body);
  const reuseUpload = await call('POST', '/inquiries', { body: { ...form('contact'), uploads: [up.ref] } });
  check('an upload cannot be attached twice', reuseUpload.status === 400, reuseUpload.body);
  const results = {};
  for (const t of ['contact', 'new_customer', 'sample_feedback', 'service']) {
    const r = await call('POST', '/inquiries', { body: form(t, t === 'service' ? { items: [{ serviceSlug: 'contract-filling' }] } : {}) });
    results[t] = r;
    check(`${t} form`, r.status === 201, r.body);
  }
  const brief = await call('POST', '/project-briefs', { body: form('contact') });
  check('/project-briefs forces form type new_product', brief.status === 201);
  const sreq = await call('POST', '/sample-requests', { body: form('contact') });
  check('/sample-requests forces form type sample_request', sreq.status === 201);
  const hp = await call('POST', '/inquiries', { body: { ...form('contact'), contact: { firstName: 'Bot', email: `bot.${RUN}@${DOMAIN}` }, hp: 'i am a bot' } });
  check('honeypot: bot gets fake success', hp.status === 201 && hp.body.referenceNo === 'DP-INQ-0000-000000');
  const noConsent = await call('POST', '/inquiries', { body: { ...form('contact'), consent: { privacy: false } } });
  check('privacy consent is required', noConsent.status === 400);
  const other = { firstName: 'Other', email: `other.${RUN}@${DOMAIN}` };
  const badItem = await call('POST', '/inquiries', { body: form('contact', { contact: other, items: [{ catalogPath: 'skincare/does-not-exist' }] }) });
  check('unknown catalog item rejected', badItem.status === 400, badItem.body);

  section('Staff login');
  const anon = await call('GET', '/inquiries');
  check('dashboard needs login', anon.status === 401);
  const badLogin = await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: 'wrong-password' } });
  check('wrong password rejected', badLogin.status === 401);
  const login = await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  if (!check('admin login', login.status === 200 && login.body.token, login.body)) throw new Error('Admin login failed – check ADMIN_EMAIL / ADMIN_PASSWORD in .env');
  const admin = login.body.token;
  const me = await call('GET', '/auth/me', { token: admin });
  check('GET /auth/me', me.status === 200 && me.body.role === 'admin');
  const sessions = await call('GET', '/auth/sessions', { token: admin });
  check('list my sessions', sessions.status === 200 && sessions.body.some((s) => s.current));

  section('Lead dashboard');
  const list = await call('GET', `/inquiries?q=${RUN}&pageSize=50`, { token: admin });
  check('list + search leads', list.status === 200 && list.body.total >= 7, list.body.total);
  const byStatus = await call('GET', '/inquiries?status=new&status=assigned&formType=new_product', { token: admin });
  check('filter by several statuses + form type', byStatus.status === 200, byStatus.body);
  const board = await call('GET', '/inquiries/board', { token: admin });
  check('board view (9 columns)', board.status === 200 && Object.keys(board.body).length === 9);
  const summary = await call('GET', '/inquiries/summary', { token: admin });
  check('summary counts', summary.status === 200 && summary.body.new >= 1, summary.body);
  const csv = await call('GET', `/inquiries/export.csv?q=${RUN}`, { token: admin });
  check('CSV export', csv.status === 200 && String(csv.body).startsWith('reference_no,') && String(csv.body).includes(r1.body.referenceNo));
  const detail = await call('GET', `/inquiries/${r1.body.id}`, { token: admin });
  check('lead detail: contact, company, items, documents, emails, timeline',
    detail.status === 200 && detail.body.contact?.email && detail.body.company?.name && detail.body.items.length === 2
      && detail.body.documents.length === 1 && detail.body.emails.some((e) => e.kind === 'customer_ack') && detail.body.timeline.length > 0,
    detail.body);
  check('two consents recorded (privacy + marketing)', detail.body.consents?.length === 2);
  const staff = await call('GET', '/users/staff', { token: admin });
  check('staff list for assignment', staff.status === 200 && staff.body.some((u) => u.id === me.body.id));
  const assign = await call('POST', `/inquiries/${r1.body.id}/assign`, { token: admin, body: { userId: me.body.id } });
  check('assign lead', assign.status === 201, assign.body);
  const afterAssign = await call('GET', `/inquiries/${r1.body.id}`, { token: admin });
  check('assigning a new lead moves it to "assigned"', afterAssign.body.status === 'assigned', afterAssign.body.status);
  const st = await call('PATCH', `/inquiries/${r1.body.id}/status`, { token: admin, body: { status: 'qualified', note: 'Good fit' } });
  check('change status', st.status === 200 && st.body.status === 'qualified');
  const badSt = await call('PATCH', `/inquiries/${r1.body.id}/status`, { token: admin, body: { status: 'banana' } });
  check('invalid status rejected', badSt.status === 400);
  check('add note', (await call('POST', `/inquiries/${r1.body.id}/notes`, { token: admin, body: { note: 'Called customer' } })).status === 201);
  const reply = await call('POST', `/inquiries/${r1.body.id}/messages`, { token: admin, body: { body: 'Thanks, we will send options.' } });
  check('reply to lead', reply.status === 201);
  const leadDocs = await call('GET', `/inquiries/${r1.body.id}/documents`, { token: admin });
  check('lead documents', leadDocs.status === 200 && leadDocs.body[0]?.latestVersion?.scanStatus);

  section('Tasks');
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const task = await call('POST', '/tasks', { token: admin, body: { title: 'Follow up call', inquiryId: r1.body.id, dueAt: yesterday, priority: 'high' } });
  check('create task', task.status === 201, task.body);
  const overdue = await call('GET', '/tasks?assignee=me&state=overdue', { token: admin });
  check('overdue tasks list', overdue.status === 200 && overdue.body.items.some((t) => t.id === task.body.id));
  const overdueLeads = await call('GET', '/inquiries?overdue=true', { token: admin });
  check('lead filter: overdue', overdueLeads.body.items?.some((i) => i.id === r1.body.id));
  const digest = await call('POST', '/tasks/send-overdue-digest', { token: admin });
  check('overdue digest queued', digest.status === 200 && digest.body.sent >= 1, digest.body);
  const doneTask = await call('POST', `/tasks/${task.body.id}/complete`, { token: admin });
  check('complete task', doneTask.status === 200 && doneTask.body.completedAt);

  section('Users, companies, customer invite');
  const qualityInvite = await call('POST', '/users/invite', { token: admin, body: { email: `quality.${RUN}@${DOMAIN}`, role: 'quality' } });
  check('invite quality staff', qualityInvite.status === 201 && qualityInvite.body.inviteToken, qualityInvite.body);
  const custNoCompany = await call('POST', '/users/invite', { token: admin, body: { email: `x.${RUN}@${DOMAIN}`, role: 'customer' } });
  check('customer invite needs a company', custNoCompany.status === 400);
  const companyId = detail.body.companyId;
  const custInvite = await call('POST', '/users/invite', { token: admin, body: { email: `buyer.${RUN}@${DOMAIN}`, role: 'customer', companyId, contactId: detail.body.contactId } });
  check('invite customer into company', custInvite.status === 201, custInvite.body);
  const dup = await call('POST', '/users/invite', { token: admin, body: { email: `buyer.${RUN}@${DOMAIN}`, role: 'customer', companyId } });
  check('duplicate user email → 409', dup.status === 409);
  const custPass = `Smoke-${RUN}-Passw0rd!`;
  const accept = await call('POST', '/auth/accept-invite', { body: { token: custInvite.body.inviteToken, password: custPass } });
  check('customer accepts invite', accept.status === 200, accept.body);
  const reuse = await call('POST', '/auth/accept-invite', { body: { token: custInvite.body.inviteToken, password: custPass + 'x' } });
  check('invite link works only once', reuse.status === 400);
  const qPass = `Smoke-${RUN}-Quality1!`;
  await call('POST', '/auth/accept-invite', { body: { token: qualityInvite.body.inviteToken, password: qPass } });
  const custLogin = await call('POST', '/auth/login', { body: { email: `buyer.${RUN}@${DOMAIN}`, password: custPass } });
  check('customer login', custLogin.status === 200 && custLogin.body.mfaSetupRequired === false, custLogin.body);
  const cust = custLogin.body.token;
  const qLogin = await call('POST', '/auth/login', { body: { email: `quality.${RUN}@${DOMAIN}`, password: qPass } });
  check('staff login flags MFA setup required', qLogin.status === 200 && qLogin.body.mfaSetupRequired === true);
  const quality = qLogin.body.token;
  check('customer cannot open the lead dashboard', (await call('GET', '/inquiries', { token: cust })).status === 403);
  check('non-admin staff cannot manage users', (await call('GET', '/users', { token: quality })).status === 403);
  const company = await call('GET', `/companies/${companyId}`, { token: admin });
  check('company detail with contacts, members, inquiries', company.status === 200 && company.body.contacts.length >= 1 && company.body.members.length === 1 && company.body.inquiries.length >= 1, company.body);
  const contacts = await call('GET', `/contacts?q=${RUN}`, { token: admin });
  check('contacts search', contacts.status === 200 && contacts.body.total >= 1);

  section('Convert lead → project (Phase 2)');
  const conv = await call('POST', `/inquiries/${r1.body.id}/convert`, { token: admin, body: { setStatus: 'qualified' } });
  check('convert to project', conv.status === 201 && /^DP-PRJ-\d{4}-\d{4}$/.test(conv.body.code), conv.body);
  const project = conv.body;
  check('project has 11 stages from the default template', project.stages?.length === 11, project.stages?.length);
  check('products copied from the inquiry', project.products?.length === 2, project.products);
  check('converting twice → 409', (await call('POST', `/inquiries/${r1.body.id}/convert`, { token: admin, body: {} })).status === 409);
  const projDocs = await call('GET', `/projects/${project.id}/documents`, { token: admin });
  check('inquiry documents moved to the project', projDocs.body?.length === 1);

  section('Customer workspace');
  const myProjects = await call('GET', '/projects', { token: cust });
  check('customer sees own project', myProjects.status === 200 && myProjects.body.items.some((p) => p.id === project.id));
  const portal = await call('GET', '/portal/overview', { token: cust });
  check('portal overview', portal.status === 200 && portal.body.projects.length >= 1);
  const portalMe = await call('PATCH', '/portal/me', { token: cust, body: { jobTitle: 'Founder' } });
  check('customer updates own profile', portalMe.status === 200 && portalMe.body.contact?.jobTitle === 'Founder', portalMe.body);
  const addFromCatalog = await call('POST', `/projects/${project.id}/products`, { token: cust, body: { catalogItemId: item.id, targetQuantity: 2000 } });
  check('customer: "Add to project" from catalog', addFromCatalog.status === 201 && addFromCatalog.body.name === item.name);
  const product = project.products[0];

  // other company's project must be invisible
  const otherCo = await call('POST', '/companies', { token: admin, body: { name: `Smoke Test Other ${RUN}` } });
  const otherProject = await call('POST', '/projects', { token: admin, body: { companyId: otherCo.body.id, name: 'Other' } });
  check('staff creates a project directly', otherProject.status === 201);
  check('customer cannot open another company\'s project', (await call('GET', `/projects/${otherProject.body.id}`, { token: cust })).status === 403);

  const br = await call('POST', `/project-products/${product.id}/briefs`, { token: cust, body: { title: 'Lotion brief', content: { scent: 'none' } } });
  check('create brief (v1)', br.status === 201 && br.body.versions[0].versionNo === 1);
  const br2 = await call('POST', `/briefs/${br.body.id}/versions`, { token: cust, body: { content: { scent: 'light citrus' } } });
  check('new brief version (v2)', br2.status === 201 && br2.body.versionNo === 2);

  const sample = await call('POST', `/project-products/${product.id}/samples`, { token: admin, body: { title: 'Lotion sample A' } });
  check('create sample', sample.status === 201);
  const rev = await call('POST', `/samples/${sample.body.id}/revisions`, { token: admin, body: { description: 'First pass', shippedAt: new Date().toISOString(), trackingNo: 'TRK1' } });
  check('sample revision shipped', rev.status === 201);
  check('customer cannot add sample revisions', (await call('POST', `/samples/${sample.body.id}/revisions`, { token: cust, body: {} })).status === 403);
  const fb = await call('POST', `/sample-revisions/${rev.body.id}/feedback`, { token: cust, body: { rating: 4, comments: 'Slightly thick' } });
  check('customer sample feedback', fb.status === 201);
  const sampleNow = await call('GET', `/samples/${sample.body.id}`, { token: cust });
  check('sample status → feedback_received', sampleNow.body.status === 'feedback_received', sampleNow.body.status);

  section('Quotes & approvals');
  const quote = await call('POST', `/projects/${project.id}/quotes`, {
    token: admin, body: { currency: 'USD', lines: [{ description: 'Lotion 250ml', quantity: 5000, unitPrice: 1.85 }, { description: 'Setup', quantity: 1, unitPrice: 750 }] },
  });
  check('create quote (draft)', quote.status === 201 && quote.body.versions[0].total === '10000.00', quote.body.versions?.[0]?.total);
  check('customer cannot see draft quote', (await call('GET', `/quotes/${quote.body.id}`, { token: cust })).status === 404);
  const sent = await call('POST', `/quotes/${quote.body.id}/send`, { token: admin });
  check('send quote', sent.status === 201 && sent.body.status === 'sent', sent.body.status);
  const v1 = sent.body.versions[0];
  const revQuote = await call('POST', `/quotes/${quote.body.id}/versions`, { token: admin, body: { lines: [{ description: 'Lotion 250ml', quantity: 5000, unitPrice: 1.8 }] } });
  check('revise quote → v2 back to draft', revQuote.status === 201 && revQuote.body.versions.length === 2 && revQuote.body.status === 'draft');
  await call('POST', `/quotes/${quote.body.id}/send`, { token: admin });
  const v2 = revQuote.body.versions[0];
  const oldApproval = await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'quote_version', targetId: v1.id, confirmationText: 'I accept this quote' } });
  check('old quote version cannot be approved', oldApproval.status === 400, oldApproval.body);
  const approve = await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'quote_version', targetId: v2.id, confirmationText: 'I accept quote v2 as shown' } });
  check('customer approves latest quote version (hash stored)', approve.status === 201 && approve.body.targetHash?.length === 64, approve.body);
  const twice = await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'quote_version', targetId: v2.id, confirmationText: 'again again' } });
  check('accepted quote cannot be approved again', twice.status === 400, twice.body);
  const quoteNow = await call('GET', `/quotes/${quote.body.id}`, { token: admin });
  check('quote → accepted', quoteNow.body.status === 'accepted');
  const leadNow = await call('GET', `/inquiries/${r1.body.id}`, { token: admin });
  check('lead → won after acceptance', leadNow.body.status === 'won', leadNow.body.status);
  const briefApprove = await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'brief_version', targetId: br2.body.id, confirmationText: 'Brief v2 approved' } });
  check('approve latest brief version', briefApprove.status === 201, briefApprove.body);
  const briefTwice = await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'brief_version', targetId: br2.body.id, confirmationText: 'Brief v2 approved' } });
  check('cannot approve the same version twice', briefTwice.status === 409, briefTwice.body);

  section('Project documents & secure download');
  const pdoc = await upload(admin, { projectId: project.id, visibility: 'customer', title: 'Formula spec' });
  check('staff upload into project', pdoc.put?.status === 200, pdoc.put?.body);
  const versionId = pdoc.put?.body.versionId;
  const blocked = await call('POST', `/document-versions/${versionId}/download-link`, { token: cust });
  check('pending (unscanned) file cannot be downloaded', blocked.status === 403);
  const release = await call('POST', `/document-versions/${versionId}/scan`, { token: admin, body: { scanStatus: 'clean' } });
  check('staff releases file', release.status === 200);
  const link = await call('POST', `/document-versions/${versionId}/download-link`, { token: cust });
  check('customer gets expiring download link', link.status === 200 && link.body.url?.includes('sig='));
  const file = await fetch(API.replace(/\/api$/, '') + link.body.url);
  const bytes = Buffer.from(await file.arrayBuffer());
  check('signed link downloads the exact file as attachment', file.status === 200 && bytes.equals(PDF) && file.headers.get('content-disposition')?.startsWith('attachment'));
  const tampered = await fetch(API.replace(/\/api$/, '') + link.body.url.replace(/sig=[^&]+/, 'sig=bad'));
  check('tampered link rejected', tampered.status === 403);
  const internal = await upload(admin, { projectId: project.id, visibility: 'internal', title: 'Internal costing' });
  const custDocs = await call('GET', `/projects/${project.id}/documents`, { token: cust });
  check('customer does not see internal documents', custDocs.status === 200 && !custDocs.body.some((d) => d.id === internal.ref?.documentId));
  const docApprove = await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'document_version', targetId: versionId, confirmationText: 'Spec approved' } });
  check('approve document version (hash = file sha256)', docApprove.status === 201 && docApprove.body.targetHash === pdoc.put.body.sha256);

  section('Stages & quality gate');
  let proj = (await call('GET', `/projects/${project.id}`, { token: admin })).body;
  const qr = proj.stages.find((s) => s.name === 'Quality Release');
  check('customer cannot complete stages', (await call('POST', `/projects/${project.id}/stages/${proj.currentStageId}/complete`, { token: cust, body: {} })).status === 403);
  check('only the current stage can be completed', (await call('POST', `/projects/${project.id}/stages/${qr.id}/complete`, { token: admin, body: {} })).status === 400);
  while (proj.currentStageId !== qr.id) {
    const r = await call('POST', `/projects/${project.id}/stages/${proj.currentStageId}/complete`, { token: admin, body: { note: 'ok' } });
    if (r.status !== 201) { check('advance stage', false, r.body); break; }
    proj = r.body;
  }
  check('advanced to Quality Release', proj.currentStageId === qr.id);
  const salesTry = await call('POST', '/users/invite', { token: admin, body: { email: `sales.${RUN}@${DOMAIN}`, role: 'sales' } });
  await call('POST', '/auth/accept-invite', { body: { token: salesTry.body.inviteToken, password: `Smoke-${RUN}-Sales11!` } });
  const sales = (await call('POST', '/auth/login', { body: { email: `sales.${RUN}@${DOMAIN}`, password: `Smoke-${RUN}-Sales11!` } })).body.token;
  check('sales cannot do Quality Release', (await call('POST', `/projects/${project.id}/stages/${qr.id}/complete`, { token: sales, body: {} })).status === 403);
  const qrDone = await call('POST', `/projects/${project.id}/stages/${qr.id}/complete`, { token: quality, body: { note: 'Batch released' } });
  check('quality staff completes Quality Release', qrDone.status === 201, qrDone.body);
  const timeline = await call('GET', `/projects/${project.id}/timeline`, { token: cust });
  check('project timeline', timeline.status === 200 && timeline.body.length >= 9);

  section('Messages, consents, dashboard, email queue, audit');
  const msg = await call('POST', `/projects/${project.id}/messages`, { token: cust, body: { body: 'When can we expect samples?' } });
  check('customer posts project message', msg.status === 201);
  const msgs = await call('GET', `/projects/${project.id}/messages`, { token: admin });
  check('staff reads project messages', msgs.status === 200 && msgs.body.length >= 1);
  const cur = await call('GET', `/contacts/${detail.body.contactId}/consents/current`, { token: admin });
  check('current consents', cur.status === 200 && cur.body.marketing?.granted === true, cur.body);
  const unsubLink = await call('GET', `/contacts/${detail.body.contactId}/consents/unsubscribe-link`, { token: admin });
  const unsubUrl = new URL(unsubLink.body.url);
  const unsub = await call('GET', `/public/unsubscribe${unsubUrl.search}`);
  check('one-click unsubscribe', unsub.status === 200, unsub.body);
  const cur2 = await call('GET', `/contacts/${detail.body.contactId}/consents/current`, { token: admin });
  check('marketing consent now withdrawn', cur2.body.marketing?.granted === false);
  const dash = await call('GET', '/dashboard/overview', { token: admin });
  check('dashboard overview', dash.status === 200 && dash.body.leads && dash.body.recentLeads.length > 0, dash.body);
  check('leads per week', (await call('GET', '/dashboard/leads-per-week?weeks=8', { token: admin })).status === 200);
  const jobs = await call('GET', `/email-jobs?inquiryId=${r1.body.id}`, { token: admin });
  check('emails queued (owner notice + customer ack), not sent – Resend pending',
    jobs.status === 200 && jobs.body.items.some((j) => j.kind === 'customer_ack' && j.status === 'queued'), jobs.body.items?.map((j) => `${j.kind}:${j.status}`));
  const audit = await call('GET', `/audit-events?entityId=${project.id}`, { token: admin });
  check('audit trail for the project', audit.status === 200 && audit.body.total >= 3);
  const tpl = await call('GET', '/stage-templates', { token: admin });
  check('stage templates', tpl.status === 200 && tpl.body.some((t) => t.isDefault));

  section('Admin CMS');
  const cmsItem = await call('GET', `/admin/catalog/items/${item.id}`, { token: admin });
  check('admin reads catalog item', cmsItem.status === 200);
  const faq = await call('POST', '/admin/faqs', { token: admin, body: { question: 'Smoke test?', answer: 'Yes', topic: `smoke-${RUN}`, isPublished: false } });
  check('admin creates FAQ', faq.status === 201);
  const pubFaqs = await call('GET', `/public/faqs?topic=smoke-${RUN}`);
  check('unpublished FAQ hidden from website', pubFaqs.status === 200 && pubFaqs.body.length === 0);
  check('admin deletes FAQ', (await call('DELETE', `/admin/faqs/${faq.body.id}`, { token: admin })).status === 200);
  check('customer cannot use CMS', (await call('GET', '/admin/catalog/items', { token: cust })).status === 403);

  section('Logout');
  const out = await call('POST', '/auth/logout', { token: cust });
  check('logout', out.status === 200);
  check('token no longer works', (await call('GET', '/auth/me', { token: cust })).status === 401);
}

// ---------------------------------------------------------------------------
async function cleanup() {
  section('Cleanup (smoke-test data only)');
  if (!ds.isInitialized) await ds.initialize();
  try {
  const users = (await ds.query(`SELECT id FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`])).map((r) => r.id);
  const contacts = (await ds.query(`SELECT id FROM contacts WHERE email LIKE $1`, [`%@${DOMAIN}`])).map((r) => r.id);
  const companies = (await ds.query(`SELECT id FROM companies WHERE name LIKE 'Smoke Test %'`)).map((r) => r.id);
  const inquiries = (await ds.query(`SELECT id FROM inquiries WHERE contact_id = ANY($1) OR idempotency_key LIKE 'smoke-%'`, [contacts])).map((r) => r.id);
  const projects = (await ds.query(`SELECT id FROM projects WHERE company_id = ANY($1)`, [companies])).map((r) => r.id);
  const keys = (await ds.query(
    `SELECT dv.storage_key FROM document_versions dv JOIN documents d ON d.id = dv.document_id
     WHERE d.project_id = ANY($1) OR d.inquiry_id = ANY($2) OR d.uploaded_by = ANY($3)
        OR (d.inquiry_id IS NULL AND d.project_id IS NULL AND d.title IN ('spec-sheet.pdf','fake.pdf','x.pdf'))`,
    [projects, inquiries, users])).map((r) => r.storage_key);

  await ds.transaction(async (m) => {
    const q = (sql, p) => m.query(sql, p);
    await q(`DELETE FROM approvals WHERE project_id = ANY($1)`, [projects]);
    await q(`DELETE FROM email_jobs WHERE inquiry_id = ANY($1) OR project_id = ANY($2) OR to_email LIKE $3`, [inquiries, projects, `%@${DOMAIN}`]);
    await q(`DELETE FROM documents WHERE project_id = ANY($1) OR inquiry_id = ANY($2) OR uploaded_by = ANY($3)
             OR (inquiry_id IS NULL AND project_id IS NULL AND title IN ('spec-sheet.pdf','fake.pdf','x.pdf'))`, [projects, inquiries, users]);
    await q(`DELETE FROM assignments WHERE inquiry_id = ANY($1) OR project_id = ANY($2) OR user_id = ANY($3)`, [inquiries, projects, users]);
    await q(`DELETE FROM projects WHERE id = ANY($1)`, [projects]);
    await q(`DELETE FROM inquiries WHERE id = ANY($1)`, [inquiries]);
    await q(`DELETE FROM tasks WHERE assignee_id = ANY($1) OR created_by = ANY($1)`, [users]);
    await q(`DELETE FROM audit_events WHERE actor_id = ANY($1) OR entity_id = ANY($2)`, [users, [...projects, ...inquiries, ...companies, ...contacts, ...users]]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
    await q(`DELETE FROM contacts WHERE id = ANY($1)`, [contacts]);
    await q(`DELETE FROM companies WHERE id = ANY($1)`, [companies]);
    await q(`DELETE FROM faqs WHERE topic LIKE 'smoke-%'`);
    await q(`DELETE FROM rate_limits WHERE key LIKE $1 OR key ~ ':(127\.0\.0\.1|::1)$'`, [`%@${DOMAIN}`]);
    // Against a deployed API the limits are keyed by this machine's public IP (SMOKE_CLIENT_IP).
    if (process.env.SMOKE_CLIENT_IP) await q(`DELETE FROM rate_limits WHERE key LIKE $1`, [`%:${process.env.SMOKE_CLIENT_IP}`]);
  });
  // stored files
  const root = process.env.STORAGE_DIR ?? './storage';
  for (const k of keys) await rm(`${root}/${k}`, { force: true });
  for (const dir of await readdir(root).catch(() => [])) {
    if ((await readdir(`${root}/${dir}`).catch(() => [null])).length === 0) await rm(`${root}/${dir}`, { recursive: true, force: true });
  }
  const left = await ds.query(`SELECT (SELECT count(*)::int FROM users WHERE email LIKE $1) u, (SELECT count(*)::int FROM companies WHERE name LIKE 'Smoke Test %') c`, [`%@${DOMAIN}`]);
  console.log(`  removed ${inquiries.length} inquiries, ${projects.length} projects, ${companies.length} companies, ${contacts.length} contacts, ${users.length} users, ${keys.length} files; left: ${JSON.stringify(left[0])}`);
  } finally {
    if (ds.isInitialized) await ds.destroy();
  }
}

try {
  // Start from clean local rate-limit counters so repeated runs are not throttled.
  if (!args.has('--cleanup')) { await cleanup(); await run(); }
} catch (err) {
  failures.push(`ABORTED: ${err.message}`);
  console.error(err);
} finally {
  if (!args.has('--keep')) await cleanup();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) console.log(` - ${failures.join('\n - ')}`);
  process.exit(failures.length ? 1 : 0);
}

// Tests for the plan features finished on 2026-10-14 (run against a running API + website, requests one at a time):
//   #10 team e-mail lists products / quantity / timing      #9  admin lead rules (assignment, priority, hours)
//   quote terms (payment schedule, taxes, exclusions…)      #21 structured sample feedback + website review linking
//   #26 admin catalog edits on the public product page      #27 catalog image upload
//   project list (several catalog concepts in one brief)   #16 sample request → project without re-typing
//
//   npm run start:dev  (API)  +  npm run dev  (website, for the product-page checks)
//   npm run smoke:plan                    run + clean up
//   npm run smoke:plan -- --keep          keep the data
// All data uses @smoke-test.invalid e-mails; the catalog item and rules are restored at the end.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const API = process.env.SMOKE_API ?? `http://localhost:${process.env.PORT ?? 3000}/api`;
const SITE = process.env.SMOKE_SITE ?? 'http://localhost:3000';
const DOMAIN = 'smoke-test.invalid';
const RUN = `p${Date.now().toString(36)}`;
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
const form = (formType, extra = {}) => ({
  formType,
  idempotencyKey: `smoke-${RUN}-${formType}-${Math.random().toString(36).slice(2, 8)}`,
  contact: { firstName: 'Smoke', lastName: formType, email: `buyer.${RUN}@${DOMAIN}` },
  company: { name: `Smoke Test Co ${RUN}` },
  message: `Smoke plan test ${formType}`,
  sourcePage: '/contact/',
  consent: { privacy: true, policyVersion: '2026-10' },
  ...extra,
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

let ds;
async function db() {
  if (!ds) { ds = (await import('../dist/database/data-source.js')).default; await ds.initialize(); }
  return ds;
}
const restore = { item: null, rules: [] };
let cookie = '';

async function upload(token, projectId, name, bytes, mimeType) {
  const init = await call('POST', '/uploads/initiate', { token, body: { filename: name, mimeType, sizeBytes: bytes.length, projectId, visibility: 'customer' } });
  if (init.status !== 201) return { init };
  const put = await call('PUT', `/uploads/${init.body.documentId}/content`, { token, raw: bytes, headers: { 'Content-Type': mimeType, 'X-Upload-Token': init.body.uploadToken, 'X-Filename': encodeURIComponent(name) } });
  const done = await call('POST', '/uploads/complete', { token, body: { documentId: init.body.documentId, token: init.body.uploadToken } });
  return { documentId: init.body.documentId, ok: put.status < 300 && done.status < 300 };
}

async function run() {
  const health = await call('GET', '/health');
  if (!check('API is up', health.status === 200, health)) throw new Error(`API not reachable at ${API}`);
  let login = await call('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  let adminEmail = process.env.ADMIN_EMAIL;
  if (login.status !== 200) {
    const { default: bcrypt } = await import('bcryptjs');
    adminEmail = `admin.${RUN}@${DOMAIN}`;
    const password = `Smoke-${RUN}-Admin1!`;
    await (await db()).query(`INSERT INTO users (email, password_hash, role, is_active) VALUES ($1, $2, 'admin', true)`, [adminEmail, await bcrypt.hash(password, 10)]);
    login = await call('POST', '/auth/login', { body: { email: adminEmail, password } });
  }
  if (!check('admin login', login.status === 200, login.body)) throw new Error('admin login failed');
  const admin = login.body.token;
  const salesInv = await call('POST', '/users/invite', { token: admin, body: { email: `sales.${RUN}@${DOMAIN}`, role: 'sales' } });
  await call('POST', '/auth/accept-invite', { body: { token: salesInv.body.inviteToken, password: `Smoke-${RUN}-Sales1!` } });
  const sales = (await call('POST', '/auth/login', { body: { email: `sales.${RUN}@${DOMAIN}`, password: `Smoke-${RUN}-Sales1!` } })).body.token;

  // ------------------------------------------------------------------ #9 rules
  section('#9 Lead rules in the admin (assignment, priority, business hours)');
  const rules = await call('GET', '/admin/settings/rules', { token: admin });
  check('admin reads the rules', rules.status === 200 && rules.body.effective?.contact?.priority, rules.body);
  restore.rules = Object.entries(rules.body.values ?? {}).map(([k, v]) => [k, v]);
  check('sales cannot read the rules → 403', (await call('GET', '/admin/settings/rules', { token: sales })).status === 403);
  const badHours = await call('PATCH', '/admin/settings/rules', { token: admin, body: { values: { 'rules.business_hours': '17:00-09:00' } } });
  check('invalid opening hours → 400', badHours.status === 400, badHours.body);
  const badZone = await call('PATCH', '/admin/settings/rules', { token: admin, body: { values: { 'rules.timezone': 'Mars/Olympus' } } });
  check('unknown time zone → 400', badZone.status === 400, badZone.body);
  const badUser = await call('PATCH', '/admin/settings/rules', { token: admin, body: { values: { 'rules.assign.contact': `nobody.${RUN}@${DOMAIN}` } } });
  check('assigning to a non-staff address → 400', badUser.status === 400, badUser.body);
  const unknownKey = await call('PATCH', '/admin/settings/rules', { token: admin, body: { values: { 'rules.salary': '1' } } });
  check('unknown rule → 400', unknownKey.status === 400, unknownKey.body);
  const setRules = await call('PATCH', '/admin/settings/rules', { token: admin, body: { values: {
    'rules.assign.contact': `sales.${RUN}@${DOMAIN}`, 'rules.priority.contact': 'urgent', 'rules.follow_up_hours': '4',
    'rules.business_hours': '00:00-24:00', 'rules.business_days': '1-7', 'rules.timezone': 'UTC',
  } } });
  check('save rules', setRules.status === 200 && setRules.body.effective?.contact?.assigneeEmail === `sales.${RUN}@${DOMAIN}` && setRules.body.effective.contact.priority === 'urgent', setRules.body);
  const before = Date.now();
  const c1 = await call('POST', '/inquiries', { body: form('contact', { inquiryType: 'general' }) });
  const lead = (await call('GET', `/inquiries/${c1.body.id}`, { token: admin })).body;
  check('new contact lead assigned by the rule', lead.status === 'assigned' && JSON.stringify(lead).includes(`sales.${RUN}@${DOMAIN}`), lead.status);
  const task = (await (await db()).query(`SELECT priority, due_at, assignee_id FROM tasks WHERE inquiry_id = $1`, [c1.body.id]))[0];
  const hours = (new Date(task?.due_at).getTime() - before) / 3_600_000;
  check('follow-up task: urgent priority, due ~4 h later (24/7 hours)', task?.priority === 'urgent' && hours > 3.7 && hours < 4.5, { task, hours });

  // ------------------------------------------------------------------ #10 team e-mail
  section('#10 Team e-mail lists the product, quantity and timing');
  const np = await call('POST', '/inquiries', { body: form('new_product', { payload: { form: 'product', fields: {
    productName: `Plan Serum ${RUN}`, category: 'Skincare', format: 'Serum', quantity: '5,000 units', fillSize: '30 ml', timing: 'Q2 2027', fillBudget: 'USD 2 per unit',
  }, labels: {} } }) });
  check('product brief sent', np.status === 201, np.body);
  const job = (await (await db()).query(`SELECT body_text FROM email_jobs WHERE inquiry_id = $1 AND template = 'owner_notice' LIMIT 1`, [np.body.id]))[0];
  if (job) {
    check('team e-mail: product row', job.body_text.includes(`Products / services: Plan Serum ${RUN} – Skincare`), job.body_text.slice(0, 600));
    check('team e-mail: quantity / size, timing, budget rows', job.body_text.includes('Quantity / size: 5,000 units · 30 ml') && job.body_text.includes('Timing: Q2 2027') && job.body_text.includes('Budget: USD 2 per unit'));
  } else {
    check('team e-mail queued (needs a recipient for "New product brief" in Settings → Emails)', false, 'no owner_notice job');
  }

  // ------------------------------------------------------------------ #16 + project list
  section('Project list: several catalog concepts in one brief');
  const two = (await call('GET', '/public/catalog/items?q=lotion&pageSize=2')).body.items;
  const paths = two.map((i) => `${i.category.slug}/${i.slug}`);
  const listBrief = await call('POST', '/inquiries', { body: form('new_product', { items: paths.map((catalogPath) => ({ catalogPath })) }) });
  check('brief with 2 listed concepts', listBrief.status === 201, listBrief.body);
  const listProject = await call('POST', `/inquiries/${listBrief.body.id}/convert`, { token: admin, body: {} });
  check('converted project has both concepts as product lines', listProject.body.products?.length === 2 && two.every((i) => listProject.body.products.some((p) => p.name === i.name)), listProject.body.products?.map((p) => p.name));
  const badPath = await call('POST', '/inquiries', { body: form('new_product', { items: [{ catalogPath: 'nope/not-a-product' }] }) });
  check('unknown concept in the list → 400', badPath.status === 400, badPath.body);

  section('#16 Sample request → project without re-typing');
  const sr = await call('POST', '/inquiries', { body: form('sample_request', { payload: { form: 'sample_request', fields: {
    productName: `Plan Lip Balm ${RUN}`, category: 'Lip care', quantity: '3 samples', country: 'Egypt', variants: 'Vanilla and mint',
  } } }) });
  const srProject = await call('POST', `/inquiries/${sr.body.id}/convert`, { token: admin, body: {} });
  const srLine = srProject.body.products?.[0];
  check('sample request → one product line named after the product', srProject.status === 201 && srProject.body.products?.length === 1 && srLine?.name === `Plan Lip Balm ${RUN}`, srProject.body.products);
  check('details copied (category, quantity, market, variants)', srLine?.details?.category === 'Lip care' && srLine.details.quantity === '3 samples' && srLine.details.market === 'Egypt' && srLine.details.references === 'Vanilla and mint', srLine?.details);
  const profile = await call('POST', '/inquiries', { body: form('new_customer', { payload: { form: 'customer', fields: { brandName: 'Smoke Brand', channels: 'Amazon' } } }) });
  const profProject = await call('POST', `/inquiries/${profile.body.id}/convert`, { token: admin, body: {} });
  check('company profile → no made-up product line', profProject.status === 201 && profProject.body.products?.length === 0, profProject.body.products);

  // ------------------------------------------------------------------ quote terms
  section('Quote terms: payment schedule, taxes, exclusions, assumptions');
  const project = (await call('POST', `/inquiries/${np.body.id}/convert`, { token: admin, body: {} })).body;
  const terms = { paymentSchedule: '50% deposit, 50% before dispatch', taxes: 'Prices exclude VAT 14%', exclusions: '   ', assumptions: 'Standard 30 ml bottle', leadTime: 'About 6–8 weeks (estimate)' };
  const q = await call('POST', `/projects/${project.id}/quotes`, { token: admin, body: { lines: [{ description: 'Serum 30 ml', quantity: 5000, unitPrice: 1.9 }], terms } });
  const v1 = q.body.versions?.[0];
  check('quote saved with terms; blank ones dropped', q.status === 201 && v1?.terms?.paymentSchedule === terms.paymentSchedule && v1.terms.taxes === terms.taxes && !('exclusions' in v1.terms) && v1.terms.leadTime, v1?.terms);
  const tooLong = await call('POST', `/projects/${project.id}/quotes`, { token: admin, body: { lines: [{ description: 'x', quantity: 1, unitPrice: 1 }], terms: { taxes: 'x'.repeat(2001) } } });
  check('term longer than allowed → 400', tooLong.status === 400, tooLong.body);
  const noTerms = await call('POST', `/projects/${project.id}/quotes`, { token: admin, body: { lines: [{ description: 'Old style', quantity: 1, unitPrice: 1 }] } });
  check('quote without terms still works (terms = {})', noTerms.status === 201 && JSON.stringify(noTerms.body.versions?.[0]?.terms) === '{}', noTerms.body.versions?.[0]?.terms);
  await call('POST', `/quotes/${q.body.id}/send`, { token: admin });
  const inv = await call('POST', '/users/invite', { token: admin, body: { email: `buyer.${RUN}@${DOMAIN}`, role: 'customer', companyId: project.companyId } });
  const pw = `Smoke-${RUN}-Passw0rd!`;
  await call('POST', '/auth/accept-invite', { body: { token: inv.body.inviteToken, password: pw } });
  const cust = (await call('POST', '/auth/login', { body: { email: `buyer.${RUN}@${DOMAIN}`, password: pw } })).body.token;
  const seen = await call('GET', `/quotes/${q.body.id}`, { token: cust });
  check('customer sees the terms', seen.status === 200 && seen.body.versions?.[0]?.terms?.assumptions === 'Standard 30 ml bottle', seen.body.versions?.[0]?.terms);
  const accept = await call('POST', `/projects/${project.id}/approvals`, { token: cust, body: { targetType: 'quote_version', targetId: v1.id, confirmationText: `I accept quote ${q.body.quoteNo}` } });
  check('customer accepts the quote with terms', accept.status === 201, accept.body);

  // ------------------------------------------------------------------ #21 structured feedback
  section('#21 Structured sample feedback in the portal');
  const line = project.products[0];
  const sample = await call('POST', `/project-products/${line.id}/samples`, { token: admin, body: { title: `Serum v1 ${RUN}` } });
  const rev = await call('POST', `/samples/${sample.body.id}/revisions`, { token: admin, body: { description: 'First lab sample' } });
  check('sample + revision created', sample.status === 201 && rev.status === 201, [sample.body, rev.body]);
  const empty = await call('POST', `/sample-revisions/${rev.body.id}/feedback`, { token: cust, body: { details: { texture: '  ' } } });
  check('empty feedback → 400', empty.status === 400, empty.body);
  const badDecision = await call('POST', `/sample-revisions/${rev.body.id}/feedback`, { token: cust, body: { details: { decision: 'love_it' } } });
  check('unknown decision → 400', badDecision.status === 400, badDecision.body);
  const otherDoc = await upload(cust, listProject.body.id, 'x.png', PNG, 'image/png');
  const foreign = await call('POST', `/sample-revisions/${rev.body.id}/feedback`, { token: cust, body: { rating: 4, details: { documentIds: [otherDoc.documentId ?? '00000000-0000-0000-0000-000000000000'] } } });
  check("attachment from another project → 400 (or upload refused)", foreign.status === 400 || !otherDoc.ok, foreign.body);
  const photo = await upload(cust, project.id, 'sample-photo.png', PNG, 'image/png');
  check('customer uploads a photo to the project', photo.ok, photo);
  const fb = await call('POST', `/sample-revisions/${rev.body.id}/feedback`, { token: cust, body: {
    rating: 4, comments: 'Nice overall',
    details: { decision: 'request_changes', appearance: 'Slightly yellow', texture: 'Too runny', scent: 'Good', afterFeel: 'A bit sticky', changes: 'Thicker, less sticky', documentIds: [photo.documentId] },
  } });
  check('structured feedback saved', fb.status === 201 && fb.body.details?.texture === 'Too runny' && fb.body.details?.decision === 'request_changes' && fb.body.details?.documentIds?.length === 1, fb.body);
  const sd = (await call('GET', `/samples/${sample.body.id}`, { token: admin })).body;
  check('staff see it on the revision; sample → feedback received', sd.status === 'feedback_received' && sd.revisions?.[0]?.feedback?.[0]?.details?.afterFeel === 'A bit sticky', sd.status);

  section('#21 Website sample review linked to the exact revision');
  const webFile = await (async () => {
    const init = await call('POST', '/uploads/initiate', { body: { filename: 'review.png', mimeType: 'image/png', sizeBytes: PNG.length } });
    await call('PUT', `/uploads/${init.body.documentId}/content`, { raw: PNG, headers: { 'Content-Type': 'image/png', 'X-Upload-Token': init.body.uploadToken, 'X-Filename': 'review.png' } });
    await call('POST', '/uploads/complete', { body: { documentId: init.body.documentId, token: init.body.uploadToken } });
    return { documentId: init.body.documentId, token: init.body.uploadToken };
  })();
  const web = await call('POST', '/inquiries', { body: form('sample_feedback', { uploads: [webFile], payload: { form: 'sample', fields: {
    reference: 'Serum v1', productName: 'Serum', decision: 'Request changes', textureChanges: 'Thicker please', fragranceChanges: 'Less fragrance', observations: 'Tested on 5 people',
  } } }) });
  check('website review sent', web.status === 201, web.body);
  const notStaff = await call('POST', `/sample-revisions/${rev.body.id}/link-inquiry`, { token: cust, body: { inquiry: web.body.referenceNo } });
  check('customer cannot link → 403', notStaff.status === 403, notStaff.body);
  const wrongType = await call('POST', `/sample-revisions/${rev.body.id}/link-inquiry`, { token: admin, body: { inquiry: c1.body.referenceNo } });
  check('a contact form cannot be linked → 400', wrongType.status === 400, wrongType.body);
  const unknown = await call('POST', `/sample-revisions/${rev.body.id}/link-inquiry`, { token: admin, body: { inquiry: 'DP-INQ-1999-000001' } });
  check('unknown reference → 404', unknown.status === 404, unknown.body);
  const link = await call('POST', `/sample-revisions/${rev.body.id}/link-inquiry`, { token: admin, body: { inquiry: web.body.referenceNo.toLowerCase() } });
  check('linked by reference (any case); answers become structured feedback', link.status === 201 && link.body.inquiryId === web.body.id && link.body.details?.texture === 'Thicker please' && link.body.details?.scent === 'Less fragrance' && link.body.details?.decision === 'request_changes' && link.body.comments?.includes('Tested on 5 people'), link.body);
  check("the form's file moved to the project and is referenced", JSON.stringify(link.body.details?.documentIds) === JSON.stringify([webFile.documentId])
    && (await (await db()).query('SELECT project_id FROM documents WHERE id = $1', [webFile.documentId]))[0]?.project_id === project.id, link.body.details?.documentIds);
  const again = await call('POST', `/sample-revisions/${rev.body.id}/link-inquiry`, { token: admin, body: { inquiry: web.body.id } });
  check('linking twice → 409', again.status === 409, again.body);

  // ------------------------------------------------------------------ #26 / #27 catalog → website
  section('#26 Admin catalog edits on the public product page + #27 image upload');
  const item = (await call('GET', '/public/catalog/items?q=baby%20shampoo&pageSize=1')).body.items?.[0];
  restore.item = item;
  const pagePath = `/formulations/${item.category.slug}/${item.slug}/`;
  const edited = await call('PATCH', `/admin/catalog/items/${item.id}`, { token: admin, body: { name: `Gentle Baby Shampoo ${RUN}`, notes: `Tear-free test description ${RUN}.`, seoTitle: `SEO title ${RUN}` } });
  check('admin edits name, description, SEO title', edited.status === 200, edited.body);
  const changes = (await call('GET', '/public/catalog/changes')).body;
  check('edit listed in /public/catalog/changes with its page path', changes.some?.((c) => c.path === pagePath && c.name === `Gentle Baby Shampoo ${RUN}`), changes.length);
  const fake = await call('PUT', `/admin/catalog/items/${item.id}/image`, { token: admin, raw: Buffer.from('<svg onload=alert(1)>'), headers: { 'Content-Type': 'image/png' } });
  check('non-image bytes sent as PNG → 400', fake.status === 400, fake.body);
  const svg = await call('PUT', `/admin/catalog/items/${item.id}/image`, { token: admin, raw: Buffer.from('<svg/>'), headers: { 'Content-Type': 'image/svg+xml' } });
  check('SVG refused → 400', svg.status === 400, svg.body);
  const big = await call('PUT', `/admin/catalog/items/${item.id}/image`, { token: admin, raw: Buffer.concat([PNG, Buffer.alloc(5.5 * 1024 * 1024)]), headers: { 'Content-Type': 'image/png' } });
  check('image over 5 MB → 400', big.status === 400 || big.status === 413, big.status);
  const bySales = await call('PUT', `/admin/catalog/items/${item.id}/image`, { token: cust, raw: PNG, headers: { 'Content-Type': 'image/png' } });
  check('customer cannot upload catalog images → 403', bySales.status === 403, bySales.status);
  const img = await call('PUT', `/admin/catalog/items/${item.id}/image`, { token: admin, raw: PNG, headers: { 'Content-Type': 'image/png' } });
  check('PNG uploaded; imageUrl set', img.status === 200 && img.body.imageUrl?.startsWith(`/api/public/catalog/images/${item.id}/`), img.body);
  const served = await fetch(API.replace(/\/api$/, '') + img.body.imageUrl);
  check('image served publicly as image/png with long cache', served.status === 200 && served.headers.get('content-type') === 'image/png' && served.headers.get('cache-control')?.includes('immutable'));
  const traversal = await call('GET', `/public/catalog/images/${item.id}/..%2F..%2F.env`);
  check('path tricks on the image URL → 404', traversal.status === 404, traversal.status);

  // Staff refresh (what Admin → Catalog does after a save): login through the website for the cookie, then /site-revalidate/.
  const refresh = async () => fetch(`${SITE}/site-revalidate/`, { method: 'POST', headers: { cookie } }).then((r) => r.status).catch(() => 0);
  try {
    const l = await fetch(`${SITE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `sales.${RUN}@${DOMAIN}`, password: `Smoke-${RUN}-Sales1!` }) });
    cookie = (l.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  } catch { /* website not running */ }
  let site = null;
  if (cookie) {
    check('staff refresh of the product pages → 200', (await refresh()) === 200);
    try { site = await fetch(`${SITE}${pagePath}`); } catch { /* website not running */ }
  }
  if (site) {
    const html = await site.text();
    check('product page shows the new name, description and image', html.includes(`Gentle Baby Shampoo ${RUN}`) && html.includes(`Tear-free test description ${RUN}.`) && html.includes(img.body.imageUrl) && html.includes('PRODUCT IMAGE'));
    check('product page <title> uses the SEO title', html.includes(`<title>SEO title ${RUN}</title>`));
    const viaSite = await fetch(`${SITE}${img.body.imageUrl}`);
    check('image loads through the website (same origin)', viaSite.status === 200);
    await call('PATCH', `/admin/catalog/items/${item.id}`, { token: admin, body: { isPublished: false } });
    await refresh();
    const gone = await fetch(`${SITE}${pagePath}`);
    check('unpublished product page → 404', gone.status === 404, gone.status);
    const deny = await fetch(`${SITE}/site-revalidate/`, { method: 'POST' });
    check('website refresh hook refuses visitors → 403', deny.status === 403, deny.status);
  } else {
    check(`website reachable at ${SITE} for the product-page checks`, false);
  }
}

try {
  await run();
} catch (e) {
  failures.push(`aborted: ${e.message}`);
  console.error(e);
}

// Restore what this test changed outside the smoke-test data.
try {
  const d = await db();
  if (restore.item) {
    const it = restore.item;
    // Back to "never edited" (updated_at = created_at), so the website shows the generated page again; the trigger would stamp now().
    await d.transaction(async (m) => {
      await m.query('ALTER TABLE catalog_items DISABLE TRIGGER trg_catalog_items_updated_at');
      await m.query(`UPDATE catalog_items SET name = $2, notes = $3, image_url = $4, seo_title = $5, seo_description = $6, is_published = true, updated_at = created_at WHERE id = $1`,
        [it.id, it.name, it.notes, it.imageUrl, it.seoTitle, it.seoDescription]);
      await m.query('ALTER TABLE catalog_items ENABLE TRIGGER trg_catalog_items_updated_at');
    });
    await rm(resolve(process.env.STORAGE_DIR ?? './storage', 'catalog-images', it.id), { recursive: true, force: true });
  }
  await d.query(`DELETE FROM app_settings WHERE key LIKE 'rules.%'`);
  for (const [k, v] of restore.rules) if (v !== null) await d.query(`INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`, [k, v]);
  if (restore.item && cookie) {
    const st = await fetch(`${SITE}/site-revalidate/`, { method: 'POST', headers: { cookie } }).then((r) => r.status).catch(() => 0);
    const page = await fetch(`${SITE}/formulations/${restore.item.category.slug}/${restore.item.slug}/`).then((r) => r.status).catch(() => 0);
    check('product page restored after the test', st === 200 && page === 200, { st, page });
  }
} catch (e) {
  failures.push(`restore failed: ${e.message}`);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✘ ${f}`);
if (ds) await ds.destroy();
if (!keep) {
  const r = spawnSync(process.execPath, ['scripts/smoke-test.mjs', '--cleanup'], { stdio: 'inherit', env: process.env });
  if (r.status) failures.push('cleanup failed');
}
process.exit(failures.length ? 1 : 0);

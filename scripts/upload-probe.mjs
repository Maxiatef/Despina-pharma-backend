// Submits one test inquiry with a PDF attachment (for check-file-persistence.mjs) and prints its reference.
//   SMOKE_API=https://despina-pharma-backend.vercel.app/api node scripts/upload-probe.mjs
// Removed by: node scripts/smoke-test.mjs --cleanup
const API = process.env.SMOKE_API ?? 'http://localhost:3000/api';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const post = (p, body) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const init = await post('/uploads/initiate', { filename: 'probe.pdf', mimeType: 'application/pdf', sizeBytes: PDF.length });
await fetch(`${API}/uploads/${init.documentId}/content`, { method: 'PUT', body: PDF, headers: { 'Content-Type': 'application/pdf', 'X-Upload-Token': init.uploadToken, 'X-Filename': 'probe.pdf' } });
await post('/uploads/complete', { documentId: init.documentId, token: init.uploadToken });
const inq = await post('/inquiries', {
  formType: 'contact', idempotencyKey: `smoke-probe-${Date.now()}`, message: 'File persistence probe',
  contact: { firstName: 'Probe', email: `probe.${Date.now().toString(36)}@smoke-test.invalid` }, company: { name: 'Smoke Test Probe' },
  uploads: [{ documentId: init.documentId, token: init.uploadToken }], consent: { privacy: true },
});
console.log(new Date().toISOString(), inq.referenceNo);

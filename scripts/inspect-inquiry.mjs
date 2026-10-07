// Read-only: show what was stored for one inquiry (items, documents, emails, task, consents).
//   node scripts/inspect-inquiry.mjs DP-INQ-2026-000065
import 'dotenv/config';
import pg from 'pg';

const ref = process.argv[2];
const c = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false } });
await c.connect();
try {
  const [inq] = (await c.query(`SELECT i.id, i.reference_no, i.form_type, i.status, i.source_page, i.created_at, ct.email, co.name company
      FROM inquiries i LEFT JOIN contacts ct ON ct.id = i.contact_id LEFT JOIN companies co ON co.id = i.company_id WHERE i.reference_no = $1`, [ref])).rows;
  if (!inq) { console.log('not found'); process.exit(1); }
  console.log(inq);
  const q = async (label, sql) => console.log(label, (await c.query(sql, [inq.id])).rows);
  await q('items:', `SELECT ii.quantity, ci.name item, s.slug service FROM inquiry_items ii LEFT JOIN catalog_items ci ON ci.id = ii.catalog_item_id LEFT JOIN services s ON s.id = ii.service_id WHERE ii.inquiry_id = $1`);
  await q('documents:', `SELECT d.title, dv.original_filename, dv.scan_status FROM documents d JOIN document_versions dv ON dv.document_id = d.id WHERE d.inquiry_id = $1`);
  await q('emails:', `SELECT kind, to_email, status, last_error FROM email_jobs WHERE inquiry_id = $1`);
  await q('tasks:', `SELECT title, due_at, assignee_id IS NOT NULL assigned FROM tasks WHERE inquiry_id = $1`);
  await q('consents:', `SELECT consent_type, granted FROM consent_records WHERE contact_id = (SELECT contact_id FROM inquiries WHERE id = $1)`);
} finally {
  await c.end();
}

// Read-only database health check: connections in use, table row counts, smoke-test leftovers.
//   node scripts/db-status.mjs
//   node scripts/db-status.mjs --kill-idle   also end this DB user's idle connections (frees the 5-connection limit)
import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10_000,
});
await client.connect();
try {
  const conns = await client.query(
    `SELECT pid, state, application_name, client_addr::text, now() - state_change AS idle_for
       FROM pg_stat_activity WHERE usename = current_user ORDER BY state_change`,
  );
  console.log(`Connections for this DB user: ${conns.rowCount} (limit 5)`);
  for (const c of conns.rows) console.log(`  pid=${c.pid} state=${c.state} app=${c.application_name || '-'} from=${c.client_addr} idle=${c.idle_for?.minutes ?? 0}m${c.idle_for?.seconds ?? 0}s`);

  if (process.argv.includes('--kill-idle')) {
    const killed = await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE usename = current_user AND pid <> pg_backend_pid() AND state = 'idle'`,
    );
    console.log(`Ended ${killed.rowCount} idle connection(s).`);
  }

  const tables = await client.query(
    `SELECT relname AS t, n_live_tup::int AS n FROM pg_stat_user_tables ORDER BY relname`,
  );
  console.log(`\nTables: ${tables.rowCount}`);
  console.log('  ' + tables.rows.map((r) => `${r.t}=${r.n}`).join(', '));

  const exact = await client.query(`SELECT
      (SELECT count(*)::int FROM catalog_items) catalog_items,
      (SELECT count(*)::int FROM catalog_categories) categories,
      (SELECT count(*)::int FROM services) services,
      (SELECT count(*)::int FROM faqs) faqs,
      (SELECT count(*)::int FROM users) users,
      (SELECT count(*)::int FROM users WHERE role = 'admin') admins,
      (SELECT count(*)::int FROM inquiries) inquiries,
      (SELECT count(*)::int FROM projects) projects,
      (SELECT count(*)::int FROM email_jobs) email_jobs,
      (SELECT count(*)::int FROM email_jobs WHERE status = 'failed') email_failed,
      (SELECT count(*)::int FROM stage_templates) stage_templates,
      (SELECT count(*)::int FROM users WHERE email LIKE '%@smoke-test.invalid') smoke_users,
      (SELECT count(*)::int FROM companies WHERE name LIKE 'Smoke Test %') smoke_companies,
      (SELECT count(*)::int FROM migrations) migrations`);
  console.log('\nKey counts:', exact.rows[0]);
} finally {
  await client.end();
}

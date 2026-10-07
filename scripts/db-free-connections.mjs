// Waits until a database connection slot is free, then ends this user's idle connections
// (left open by frozen Vercel function instances) so the API can connect again.
//   node scripts/db-free-connections.mjs [maxMinutes=15]
import 'dotenv/config';
import pg from 'pg';

const deadline = Date.now() + Number(process.argv[2] ?? 15) * 60_000;
const cfg = {
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000,
};

while (Date.now() < deadline) {
  const c = new pg.Client(cfg);
  try {
    await c.connect();
    const r = await c.query(
      `SELECT pg_terminate_backend(pid) AS ended, state, now() - state_change AS idle FROM pg_stat_activity
        WHERE usename = current_user AND pid <> pg_backend_pid() AND state = 'idle'`,
    );
    const left = await c.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE usename = current_user`);
    console.log(`${new Date().toISOString()} connected; ended ${r.rowCount} idle connection(s); now in use: ${left.rows[0].n}`);
    await c.end();
    process.exit(0);
  } catch (e) {
    console.log(`${new Date().toISOString()} ${e.message}`);
    await c.end().catch(() => {});
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
console.log('gave up');
process.exit(1);

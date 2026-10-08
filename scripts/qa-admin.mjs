// Temporary admin for running the smoke tests when the .env admin does not match the database.
//   node scripts/qa-admin.mjs create   → prints ADMIN_EMAIL / ADMIN_PASSWORD to use
//   node scripts/qa-admin.mjs remove   → deletes every qa-admin.*@qa.invalid user (and their sessions/audit rows)
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import ds from '../dist/database/data-source.js';

await ds.initialize();
try {
  if (process.argv[2] === 'create') {
    const run = Date.now().toString(36);
    const email = `qa-admin.${run}@qa.invalid`;
    const password = `Qa-${run}-Admin1!`;
    await ds.query(`INSERT INTO users (email, password_hash, role, is_active) VALUES ($1, $2, 'admin', true)`, [email, await bcrypt.hash(password, 10)]);
    console.log(`ADMIN_EMAIL=${email}\nADMIN_PASSWORD=${password}`);
  } else {
    const ids = (await ds.query(`SELECT id FROM users WHERE email LIKE 'qa-admin.%@qa.invalid'`)).map((r) => r.id);
    await ds.query(`DELETE FROM audit_events WHERE actor_id = ANY($1) OR actor_email LIKE '%@qa.invalid' OR summary LIKE '%@qa.invalid%'`, [ids]);
    await ds.query(`DELETE FROM tasks WHERE created_by = ANY($1) OR assignee_id = ANY($1)`, [ids]);
    await ds.query(`DELETE FROM email_jobs WHERE to_email LIKE '%@qa.invalid'`);
    await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
    console.log(`removed ${ids.length} QA admin(s)`);
  }
} finally {
  await ds.destroy();
}

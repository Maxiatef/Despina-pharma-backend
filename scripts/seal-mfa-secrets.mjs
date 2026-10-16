// Encrypts 2FA keys that are still stored as plain text (set up before 2026-10-16).
// Run once on a database AFTER the new backend is live there (older backends cannot read encrypted keys):
//   npm run build && node scripts/seal-mfa-secrets.mjs          → shows how many would change
//   npm run build && node scripts/seal-mfa-secrets.mjs --apply  → encrypts them
// Uses MFA_ENCRYPTION_KEY (or APP_SECRET) from .env – the same value the backend uses.
import 'dotenv/config';
import ds from '../dist/database/data-source.js';
import { isSealed, sealSecret } from '../dist/common/secret-box.js';

const apply = process.argv.includes('--apply');
await ds.initialize();
try {
  const rows = await ds.query(`SELECT id, mfa_secret FROM users WHERE mfa_secret IS NOT NULL`);
  const plain = rows.filter((r) => !isSealed(r.mfa_secret));
  console.log(`${rows.length} account(s) with a 2FA key, ${plain.length} still plain text`);
  if (apply) {
    for (const r of plain) await ds.query(`UPDATE users SET mfa_secret = $2 WHERE id = $1`, [r.id, sealSecret(r.mfa_secret)]);
    console.log(`encrypted ${plain.length}`);
  } else if (plain.length) {
    console.log('dry run – add --apply to encrypt them');
  }
} finally {
  await ds.destroy();
}

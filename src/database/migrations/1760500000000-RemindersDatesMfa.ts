import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reminders (waiting on customer / waiting on us), target vs promised dates, 2FA backup codes. Additive.
 */
export class RemindersDatesMfa1760500000000 implements MigrationInterface {
  name = 'RemindersDatesMfa1760500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes jsonb`);
    for (const t of ['projects', 'project_products']) {
      await q.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS target_date date`);
      await q.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS promised_date date`);
    }
    await q.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS reminders_off_at timestamptz`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS reminder_states (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        item_key varchar(120) NOT NULL UNIQUE,
        item_type varchar(20) NOT NULL,
        item_id uuid NOT NULL,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE CASCADE,
        waiting_since timestamptz NOT NULL,
        sent_count int NOT NULL DEFAULT 0,
        last_sent_at timestamptz,
        paused_at timestamptz,
        paused_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS reminder_states`);
    await q.query(`ALTER TABLE contacts DROP COLUMN IF EXISTS reminders_off_at`);
    for (const t of ['projects', 'project_products']) {
      await q.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS promised_date`);
      await q.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS target_date`);
    }
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS mfa_backup_codes`);
  }
}

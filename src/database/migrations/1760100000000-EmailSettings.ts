import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * E-mail sending with Resend + admin e-mail settings.
 * - app_settings: key/value settings edited in Admin → Settings → Emails (sender, recipients, on/off switches).
 * - email_jobs.kind / status and email_events.event become text (new e-mail types need no enum change);
 *   new status "skipped" (test address, bounced address, switched off); body_html + template name stored.
 * - contacts.email_status: "bounced" / "complained" reported by the Resend webhook → not mailed again.
 * - E-mails queued before sending was connected are marked "skipped" so nothing old goes out by surprise.
 */
export class EmailSettings1760100000000 implements MigrationInterface {
  name = 'EmailSettings1760100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key varchar(120) PRIMARY KEY,
        value text,
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`ALTER TABLE email_jobs ALTER COLUMN kind TYPE varchar(40) USING kind::text`);
    await q.query(`ALTER TABLE email_jobs ALTER COLUMN status DROP DEFAULT`);
    await q.query(`ALTER TABLE email_jobs ALTER COLUMN status TYPE varchar(20) USING status::text`);
    await q.query(`ALTER TABLE email_jobs ALTER COLUMN status SET DEFAULT 'queued'`);
    await q.query(`ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS body_html text, ADD COLUMN IF NOT EXISTS template varchar(60), ADD COLUMN IF NOT EXISTS last_event varchar(30), ADD COLUMN IF NOT EXISTS last_event_at timestamptz`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON email_jobs (status, created_at)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_email_jobs_provider_id ON email_jobs (provider_message_id)`);
    await q.query(`ALTER TABLE email_events ALTER COLUMN event TYPE varchar(30) USING event::text`);

    await q.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_status varchar(20), ADD COLUMN IF NOT EXISTS email_status_at timestamptz, ADD COLUMN IF NOT EXISTS email_status_detail text`);

    await q.query(`
      UPDATE email_jobs SET status = 'skipped',
        last_error = 'Not sent: created before e-mail sending was connected (2026-10-09)'
      WHERE status IN ('queued', 'failed', 'sending')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE email_jobs SET status = 'failed' WHERE status = 'skipped'`);
    await q.query(`ALTER TABLE contacts DROP COLUMN IF EXISTS email_status, DROP COLUMN IF EXISTS email_status_at, DROP COLUMN IF EXISTS email_status_detail`);
    await q.query(`DROP INDEX IF EXISTS idx_email_jobs_status`);
    await q.query(`DROP INDEX IF EXISTS idx_email_jobs_provider_id`);
    await q.query(`ALTER TABLE email_jobs DROP COLUMN IF EXISTS body_html, DROP COLUMN IF EXISTS template, DROP COLUMN IF EXISTS last_event, DROP COLUMN IF EXISTS last_event_at`);
    // Values outside the old enums are mapped back before the columns return to their enum types.
    await q.query(`UPDATE email_events SET event = 'failed' WHERE event NOT IN (SELECT unnest(enum_range(NULL::email_event_type))::text)`);
    await q.query(`ALTER TABLE email_events ALTER COLUMN event TYPE email_event_type USING event::email_event_type`);
    await q.query(`ALTER TABLE email_jobs ALTER COLUMN status DROP DEFAULT`);
    await q.query(`ALTER TABLE email_jobs ALTER COLUMN status TYPE email_job_status USING status::email_job_status`);
    await q.query(`ALTER TABLE email_jobs ALTER COLUMN status SET DEFAULT 'queued'`);
    await q.query(`UPDATE email_jobs SET kind = 'staff_alert' WHERE kind NOT IN (SELECT unnest(enum_range(NULL::email_kind))::text)`);
    await q.query(`ALTER TABLE email_jobs ALTER COLUMN kind TYPE email_kind USING kind::email_kind`);
    await q.query(`DROP TABLE IF EXISTS app_settings`);
  }
}

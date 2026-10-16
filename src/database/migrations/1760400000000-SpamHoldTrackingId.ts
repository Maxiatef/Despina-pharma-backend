import { MigrationInterface, QueryRunner } from 'typeorm';

/** Spam holding area for website forms and a tracking (request) ID on inquiries and e-mails. Additive. */
export class SpamHoldTrackingId1760400000000 implements MigrationInterface {
  name = 'SpamHoldTrackingId1760400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS held_at timestamptz`);
    await q.query(`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS hold_reasons jsonb`);
    await q.query(`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS request_id varchar(64)`);
    await q.query(`ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS request_id varchar(64)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_inquiries_held ON inquiries (held_at) WHERE held_at IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_inquiries_held`);
    await q.query(`ALTER TABLE email_jobs DROP COLUMN IF EXISTS request_id`);
    await q.query(`ALTER TABLE inquiries DROP COLUMN IF EXISTS request_id`);
    await q.query(`ALTER TABLE inquiries DROP COLUMN IF EXISTS hold_reasons`);
    await q.query(`ALTER TABLE inquiries DROP COLUMN IF EXISTS held_at`);
  }
}

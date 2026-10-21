import { MigrationInterface, QueryRunner } from 'typeorm';

/** When an approval was last requested for a document version. Additive. */
export class ApprovalRequestedAt1760700000000 implements MigrationInterface {
  name = 'ApprovalRequestedAt1760700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE document_versions DROP COLUMN IF EXISTS approval_requested_at`);
  }
}

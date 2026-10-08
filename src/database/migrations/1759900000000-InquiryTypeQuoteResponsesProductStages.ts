import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Additive only – the deployed API keeps working before and after it runs.
 * - inquiries.inquiry_type: the topic chosen on the contact form.
 * - quote_status 'changes_requested' + quote_responses: the customer can decline a quote or ask for changes.
 * - project_stages.project_product_id + project_products.current_stage_id: stages per product line
 *   (project-level stages keep project_product_id NULL).
 * - Backfill: one follow-up task for every still-open inquiry that has none (new inquiries get one automatically).
 */
export class InquiryTypeQuoteResponsesProductStages1759900000000 implements MigrationInterface {
  name = 'InquiryTypeQuoteResponsesProductStages1759900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS inquiry_type varchar(40)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_inquiries_inquiry_type ON inquiries (inquiry_type)`);

    await q.query(`ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'changes_requested'`);
    await q.query(`DO $$ BEGIN CREATE TYPE quote_response_decision AS ENUM ('declined', 'changes_requested'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS quote_responses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        quote_version_id uuid NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
        decision quote_response_decision NOT NULL,
        note text,
        responded_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_quote_responses_quote ON quote_responses (quote_id)`);

    await q.query(`ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS project_product_id uuid REFERENCES project_products(id) ON DELETE CASCADE`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_project_stages_product ON project_stages (project_product_id)`);
    await q.query(`ALTER TABLE project_products ADD COLUMN IF NOT EXISTS current_stage_id uuid REFERENCES project_stages(id) ON DELETE SET NULL`);

    await q.query(`
      INSERT INTO tasks (inquiry_id, assignee_id, title, priority, due_at)
      SELECT i.id, a.user_id, 'Follow up: ' || i.reference_no, 'normal', i.created_at + interval '1 day'
      FROM inquiries i
      LEFT JOIN assignments a ON a.inquiry_id = i.id AND a.unassigned_at IS NULL
      WHERE i.status IN ('new', 'assigned', 'awaiting_customer', 'qualified')
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.inquiry_id = i.id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop the 'changes_requested' enum value; quotes using it go back to 'sent'.
    await q.query(`UPDATE quotes SET status = 'sent' WHERE status = 'changes_requested'`);
    await q.query(`ALTER TABLE project_products DROP COLUMN IF EXISTS current_stage_id`);
    await q.query(`DELETE FROM project_stages WHERE project_product_id IS NOT NULL`);
    await q.query(`ALTER TABLE project_stages DROP COLUMN IF EXISTS project_product_id`);
    await q.query(`DROP TABLE IF EXISTS quote_responses`);
    await q.query(`DROP TYPE IF EXISTS quote_response_decision`);
    await q.query(`ALTER TABLE inquiries DROP COLUMN IF EXISTS inquiry_type`);
  }
}

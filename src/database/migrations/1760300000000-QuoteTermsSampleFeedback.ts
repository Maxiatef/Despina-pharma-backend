import { MigrationInterface, QueryRunner } from 'typeorm';

/** Quote terms (payment schedule, taxes, exclusions, assumptions) and structured sample feedback. Additive. */
export class QuoteTermsSampleFeedback1760300000000 implements MigrationInterface {
  name = 'QuoteTermsSampleFeedback1760300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE quote_versions ADD COLUMN IF NOT EXISTS terms jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE feedback DROP COLUMN IF EXISTS details`);
    await q.query(`ALTER TABLE quote_versions DROP COLUMN IF EXISTS terms`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - Adds the product kinds that exist in the delivered catalog-data.json.
 * - Stores the rendered email body on email_jobs so queued emails survive restarts
 *   (needed until Resend is connected and jobs can be sent).
 * - Keeps every supplier reference of a catalog item (an item can have several sources).
 */
export class CatalogKindsAndEmailBody1759800000000 implements MigrationInterface {
  name = 'CatalogKindsAndEmailBody1759800000000';
  // Runs inside the normal migration transaction (ALTER TYPE ... ADD VALUE is allowed there on PostgreSQL 12+).

  public async up(q: QueryRunner): Promise<void> {
    for (const kind of ['assortment', 'product-type', 'format-option', 'program-service']) {
      await q.query(`ALTER TYPE catalog_item_kind ADD VALUE IF NOT EXISTS '${kind}'`);
    }
    await q.query(`ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS body_text text`);
    await q.query(`ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop enum values; only the columns are removed.
    await q.query(`ALTER TABLE catalog_items DROP COLUMN IF EXISTS sources`);
    await q.query(`ALTER TABLE email_jobs DROP COLUMN IF EXISTS body_text`);
  }
}

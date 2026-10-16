import { MigrationInterface, QueryRunner } from 'typeorm';

/** Detailed product-line brief (format, path, fill size, ingredients, packaging, market, launch, budget, "not sure yet"). Additive. */
export class ProductLineDetails1760200000000 implements MigrationInterface {
  name = 'ProductLineDetails1760200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE project_products ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE project_products DROP COLUMN IF EXISTS details`);
  }
}

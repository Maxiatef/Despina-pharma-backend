import { MigrationInterface, QueryRunner } from 'typeorm';

/** In-app notifications (the bell): one row per person per event. Additive. */
export class Notifications1760600000000 implements MigrationInterface {
  name = 'Notifications1760600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title varchar(300) NOT NULL,
        link varchar(300),
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE CASCADE,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications (user_id, created_at DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS notifications`);
  }
}

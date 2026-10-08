import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Full audit trail: one row per user action (everything except sign-in / sign-out), written by AuditInterceptor.
 * Additive except entity_type, which becomes text so new record types never need an enum change.
 */
export class AuditLogDetails1760000000000 implements MigrationInterface {
  name = 'AuditLogDetails1760000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE audit_events ALTER COLUMN entity_type TYPE varchar(40) USING entity_type::text`);
    await q.query(`
      ALTER TABLE audit_events
        ADD COLUMN IF NOT EXISTS actor_email varchar(254),
        ADD COLUMN IF NOT EXISTS actor_role varchar(20),
        ADD COLUMN IF NOT EXISTS summary text,
        ADD COLUMN IF NOT EXISTS entity_label varchar(300),
        ADD COLUMN IF NOT EXISTS project_id uuid,
        ADD COLUMN IF NOT EXISTS inquiry_id uuid,
        ADD COLUMN IF NOT EXISTS company_id uuid,
        ADD COLUMN IF NOT EXISTS method varchar(10),
        ADD COLUMN IF NOT EXISTS path varchar(500),
        ADD COLUMN IF NOT EXISTS status_code int,
        ADD COLUMN IF NOT EXISTS user_agent text,
        ADD COLUMN IF NOT EXISTS details jsonb`);
    // Old rows: fill the actor e-mail/role so they read the same as new ones.
    await q.query(`UPDATE audit_events a SET actor_email = u.email, actor_role = u.role::text FROM users u WHERE u.id = a.actor_id AND a.actor_email IS NULL`);
    for (const [name, cols] of [
      ['idx_audit_created', 'created_at DESC'], ['idx_audit_actor', 'actor_id, created_at DESC'], ['idx_audit_entity', 'entity_type, entity_id'],
      ['idx_audit_action', 'action'], ['idx_audit_project', 'project_id'], ['idx_audit_inquiry', 'inquiry_id'], ['idx_audit_company', 'company_id'],
    ]) {
      await q.query(`CREATE INDEX IF NOT EXISTS ${name} ON audit_events (${cols})`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const name of ['idx_audit_created', 'idx_audit_actor', 'idx_audit_entity', 'idx_audit_action', 'idx_audit_project', 'idx_audit_inquiry', 'idx_audit_company']) {
      await q.query(`DROP INDEX IF EXISTS ${name}`);
    }
    await q.query(`
      ALTER TABLE audit_events
        DROP COLUMN IF EXISTS actor_email, DROP COLUMN IF EXISTS actor_role, DROP COLUMN IF EXISTS summary,
        DROP COLUMN IF EXISTS entity_label, DROP COLUMN IF EXISTS project_id, DROP COLUMN IF EXISTS inquiry_id,
        DROP COLUMN IF EXISTS company_id, DROP COLUMN IF EXISTS method, DROP COLUMN IF EXISTS path,
        DROP COLUMN IF EXISTS status_code, DROP COLUMN IF EXISTS user_agent, DROP COLUMN IF EXISTS details`);
    // Rows with record types outside the old enum are kept as 'settings' so the column can go back to the enum.
    await q.query(`UPDATE audit_events SET entity_type = 'settings' WHERE entity_type::text NOT IN (SELECT unnest(enum_range(NULL::audit_entity))::text)`);
    await q.query(`ALTER TABLE audit_events ALTER COLUMN entity_type TYPE audit_entity USING entity_type::audit_entity`);
  }
}

import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { User } from './user.entity.js';

/**
 * Audit trail: one row per user action (everything except sign-in / sign-out), who did what, to which record,
 * with the record before and after. Rows are only ever inserted. entity_id can point at any table (no foreign key).
 */
@Entity('audit_events')
export class AuditEvent extends BaseEntity {
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor?: Relation<User> | null;

  /** Copied at the time of the action, so the row still reads correctly if the user is renamed or deleted. */
  @Column({ name: 'actor_email', type: 'varchar', length: 254, nullable: true })
  actorEmail: string | null;

  @Column({ name: 'actor_role', type: 'varchar', length: 20, nullable: true })
  actorRole: string | null;

  /** e.g. task.complete, quote.send, inquiry.submit */
  @Column({ type: 'varchar', length: 100 })
  action: string;

  /** One readable sentence: "anna@despina.com completed task "Follow up DP-INQ-…"" */
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ name: 'entity_type', type: 'varchar', length: 40 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  /** Name / reference / title of the record at the time of the action. */
  @Column({ name: 'entity_label', type: 'varchar', length: 300, nullable: true })
  entityLabel: string | null;

  // Context for filtering ("everything that happened on this project / lead / company").
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: unknown;

  @Column({ type: 'jsonb', nullable: true })
  after: unknown;

  /** { input (request body, secrets hidden), changes [{field, from, to}], events (service details), result } */
  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  method: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  path: string | null;

  @Column({ name: 'status_code', type: 'int', nullable: true })
  statusCode: number | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;
}

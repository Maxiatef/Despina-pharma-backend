import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { AUDIT_ENTITIES } from '../../common/enums.js';
import type { AuditEntity } from '../../common/enums.js';
import { User } from './user.entity.js';

/** Who did what, and when. entity_id can point at any table, so it has no foreign key. */
@Entity('audit_events')
export class AuditEvent extends BaseEntity {
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor?: Relation<User> | null;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Column({ name: 'entity_type', type: 'enum', enum: AUDIT_ENTITIES, enumName: 'audit_entity' })
  entityType: AuditEntity;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: unknown;

  @Column({ type: 'jsonb', nullable: true })
  after: unknown;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;
}

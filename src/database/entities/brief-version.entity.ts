import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { Brief } from './brief.entity.js';
import { User } from './user.entity.js';

@Entity('brief_versions')
export class BriefVersion extends BaseEntity {
  @Column({ name: 'brief_id', type: 'uuid' })
  briefId: string;

  @ManyToOne(() => Brief, (x) => x.versions, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'brief_id' })
  brief?: Relation<Brief>;

  @Column({ name: 'version_no', type: 'int', default: 1 })
  versionNo: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  content: Record<string, unknown>;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser?: Relation<User> | null;
}

import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { USER_ROLES } from '../../common/enums.js';
import type { UserRole } from '../../common/enums.js';
import { Project } from './project.entity.js';
import { User } from './user.entity.js';

@Entity('project_stages')
export class ProjectStage extends BaseEntity {
  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (x) => x.stages, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'project_id' })
  project?: Relation<Project>;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'requires_role', type: 'enum', enum: USER_ROLES, enumName: 'user_role', nullable: true })
  requiresRole: UserRole | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'completed_by', type: 'uuid', nullable: true })
  completedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'completed_by' })
  completedByUser?: Relation<User> | null;
}

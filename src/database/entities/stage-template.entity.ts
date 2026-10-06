import { Column, Entity, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import type { UserRole } from '../../common/enums.js';
import { Project } from './project.entity.js';

export interface StageDefinition {
  name: string;
  requiresRole?: UserRole;
}

@Entity('stage_templates')
export class StageTemplate extends BaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  stages: StageDefinition[];

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @OneToMany(() => Project, (x) => x.stageTemplate)
  projects?: Relation<Project[]>;
}

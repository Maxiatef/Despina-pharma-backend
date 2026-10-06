import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { PROJECT_STATUSES } from '../../common/enums.js';
import type { ProjectStatus } from '../../common/enums.js';
import { Approval } from './approval.entity.js';
import { Company } from './company.entity.js';
import { Document } from './document.entity.js';
import { Inquiry } from './inquiry.entity.js';
import { Message } from './message.entity.js';
import { ProjectProduct } from './project-product.entity.js';
import { ProjectStage } from './project-stage.entity.js';
import { Quote } from './quote.entity.js';
import { StageTemplate } from './stage-template.entity.js';
import { Task } from './task.entity.js';
import { User } from './user.entity.js';

/** Customer project (workspace). One project can hold several products. */
@Entity('projects')
export class Project extends BaseEntity {
  @Column({ type: 'varchar', length: 30 })
  code: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, (x) => x.projects, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'company_id' })
  company?: Relation<Company>;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'enum', enum: PROJECT_STATUSES, enumName: 'project_status', default: 'active' })
  status: ProjectStatus;

  @Column({ name: 'stage_template_id', type: 'uuid', nullable: true })
  stageTemplateId: string | null;

  @ManyToOne(() => StageTemplate, (x) => x.projects, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'stage_template_id' })
  stageTemplate?: Relation<StageTemplate> | null;

  @Column({ name: 'current_stage_id', type: 'uuid', nullable: true })
  currentStageId: string | null;

  @ManyToOne(() => ProjectStage, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'current_stage_id' })
  currentStage?: Relation<ProjectStage> | null;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_id' })
  owner?: Relation<User> | null;

  @Column({ name: 'source_inquiry_id', type: 'uuid', nullable: true })
  sourceInquiryId: string | null;

  @ManyToOne(() => Inquiry, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_inquiry_id' })
  sourceInquiry?: Relation<Inquiry> | null;

  @OneToMany(() => ProjectStage, (x) => x.project)
  stages?: Relation<ProjectStage[]>;

  @OneToMany(() => ProjectProduct, (x) => x.project)
  products?: Relation<ProjectProduct[]>;

  @OneToMany(() => Quote, (x) => x.project)
  quotes?: Relation<Quote[]>;

  @OneToMany(() => Approval, (x) => x.project)
  approvals?: Relation<Approval[]>;

  @OneToMany(() => Message, (x) => x.project)
  messages?: Relation<Message[]>;

  @OneToMany(() => Document, (x) => x.project)
  documents?: Relation<Document[]>;

  @OneToMany(() => Task, (x) => x.project)
  tasks?: Relation<Task[]>;
}

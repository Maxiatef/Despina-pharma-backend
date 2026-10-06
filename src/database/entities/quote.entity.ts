import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { QUOTE_STATUSES } from '../../common/enums.js';
import type { QuoteStatus } from '../../common/enums.js';
import { Project } from './project.entity.js';
import { QuoteVersion } from './quote-version.entity.js';
import { User } from './user.entity.js';

@Entity('quotes')
export class Quote extends BaseEntity {
  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (x) => x.quotes, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'project_id' })
  project?: Relation<Project>;

  @Column({ name: 'quote_no', type: 'varchar', length: 30 })
  quoteNo: string;

  @Column({ type: 'enum', enum: QUOTE_STATUSES, enumName: 'quote_status', default: 'draft' })
  status: QuoteStatus;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser?: Relation<User> | null;

  @OneToMany(() => QuoteVersion, (x) => x.quote)
  versions?: Relation<QuoteVersion[]>;
}

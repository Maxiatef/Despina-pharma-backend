import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { INQUIRY_STATUSES } from '../../common/enums.js';
import type { InquiryStatus } from '../../common/enums.js';
import { Inquiry } from './inquiry.entity.js';
import { Project } from './project.entity.js';
import { User } from './user.entity.js';

/** Status history / notes – the activity timeline. */
@Entity('status_events')
export class StatusEvent extends BaseEntity {
  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @ManyToOne(() => Inquiry, (x) => x.statusEvents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry?: Relation<Inquiry> | null;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Relation<Project> | null;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_id' })
  actor?: Relation<User> | null;

  @Column({ name: 'from_status', type: 'enum', enum: INQUIRY_STATUSES, enumName: 'inquiry_status', nullable: true })
  fromStatus: InquiryStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: INQUIRY_STATUSES, enumName: 'inquiry_status', nullable: true })
  toStatus: InquiryStatus | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}

import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import type { EmailEventType } from '../../common/enums.js';
import { EmailJob } from './email-job.entity.js';

/** Delivery events from the email provider webhook. */
@Entity('email_events')
export class EmailEvent extends BaseEntity {
  @Column({ name: 'email_job_id', type: 'uuid' })
  emailJobId: string;

  @ManyToOne(() => EmailJob, (x) => x.events, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'email_job_id' })
  emailJob?: Relation<EmailJob>;

  @Column({ type: 'varchar', length: 30 })
  event: EmailEventType;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  raw: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;
}

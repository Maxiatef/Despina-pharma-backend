import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { EMAIL_JOB_STATUSES, EMAIL_KINDS } from '../../common/enums.js';
import type { EmailJobStatus, EmailKind } from '../../common/enums.js';
import { EmailEvent } from './email-event.entity.js';
import { Inquiry } from './inquiry.entity.js';
import { Project } from './project.entity.js';

/** Outgoing email queue. TODO(resend): sent by the Resend provider later. */
@Entity('email_jobs')
export class EmailJob extends BaseEntity {
  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @ManyToOne(() => Inquiry, (x) => x.emailJobs, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry?: Relation<Inquiry> | null;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => Project, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project?: Relation<Project> | null;

  @Column({ type: 'enum', enum: EMAIL_KINDS, enumName: 'email_kind' })
  kind: EmailKind;

  @Column({ name: 'to_email', type: 'varchar', length: 254 })
  toEmail: string;

  @Column({ type: 'varchar', length: 300 })
  subject: string;

  @Column({ name: 'body_text', type: 'text', nullable: true })
  bodyText: string | null;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 200, nullable: true })
  providerMessageId: string | null;

  @Column({ type: 'enum', enum: EMAIL_JOB_STATUSES, enumName: 'email_job_status', default: 'queued' })
  status: EmailJobStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @OneToMany(() => EmailEvent, (x) => x.emailJob)
  events?: Relation<EmailEvent[]>;
}

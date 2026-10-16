import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import type { EmailJobStatus, EmailKind } from '../../common/enums.js';
import { EmailEvent } from './email-event.entity.js';
import { Inquiry } from './inquiry.entity.js';
import { Project } from './project.entity.js';

/** Outgoing e-mail: written first, then sent through Resend (right after the request, retried by the queue). */
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

  @Column({ type: 'varchar', length: 40 })
  kind: EmailKind;

  /** Template used (e.g. sample_shipped) – see email.templates.ts. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  template: string | null;

  /** Tracking ID of the request that queued it. */
  @Column({ name: 'request_id', type: 'varchar', length: 64, nullable: true })
  requestId: string | null;

  @Column({ name: 'to_email', type: 'varchar', length: 254 })
  toEmail: string;

  @Column({ type: 'varchar', length: 300 })
  subject: string;

  @Column({ name: 'body_text', type: 'text', nullable: true })
  bodyText: string | null;

  @Column({ name: 'body_html', type: 'text', nullable: true })
  bodyHtml: string | null;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 200, nullable: true })
  providerMessageId: string | null;

  /** queued → sending → sent | failed (retried) | skipped (test address, bounced address, switched off) */
  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: EmailJobStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  /** Latest delivery event reported by the Resend webhook (delivered, bounced, complaint …). */
  @Column({ name: 'last_event', type: 'varchar', length: 30, nullable: true })
  lastEvent: string | null;

  @Column({ name: 'last_event_at', type: 'timestamptz', nullable: true })
  lastEventAt: Date | null;

  @OneToMany(() => EmailEvent, (x) => x.emailJob)
  events?: Relation<EmailEvent[]>;
}

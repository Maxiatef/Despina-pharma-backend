import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { FORM_TYPES, INQUIRY_STATUSES } from '../../common/enums.js';
import type { FormType, InquiryStatus } from '../../common/enums.js';
import { Assignment } from './assignment.entity.js';
import { Company } from './company.entity.js';
import { ConsentRecord } from './consent-record.entity.js';
import { Contact } from './contact.entity.js';
import { Document } from './document.entity.js';
import { EmailJob } from './email-job.entity.js';
import { InquiryItem } from './inquiry-item.entity.js';
import { Message } from './message.entity.js';
import { StatusEvent } from './status-event.entity.js';
import { Task } from './task.entity.js';

/** A submission from one of the 6 website forms (a lead). */
@Entity('inquiries')
export class Inquiry extends BaseEntity {
  @Column({ name: 'reference_no', type: 'varchar', length: 30 })
  referenceNo: string;

  @Column({ name: 'form_type', type: 'enum', enum: FORM_TYPES, enumName: 'form_type' })
  formType: FormType;

  @Column({ type: 'enum', enum: INQUIRY_STATUSES, enumName: 'inquiry_status', default: 'new' })
  status: InquiryStatus;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @ManyToOne(() => Contact, (x) => x.inquiries, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'contact_id' })
  contact?: Relation<Contact>;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => Company, (x) => x.inquiries, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'company_id' })
  company?: Relation<Company> | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @Column({ name: 'source_page', type: 'varchar', length: 500, nullable: true })
  sourcePage: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 100 })
  idempotencyKey: string;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @OneToMany(() => InquiryItem, (x) => x.inquiry)
  items?: Relation<InquiryItem[]>;

  @OneToMany(() => Assignment, (x) => x.inquiry)
  assignments?: Relation<Assignment[]>;

  @OneToMany(() => Task, (x) => x.inquiry)
  tasks?: Relation<Task[]>;

  @OneToMany(() => StatusEvent, (x) => x.inquiry)
  statusEvents?: Relation<StatusEvent[]>;

  @OneToMany(() => Document, (x) => x.inquiry)
  documents?: Relation<Document[]>;

  @OneToMany(() => EmailJob, (x) => x.inquiry)
  emailJobs?: Relation<EmailJob[]>;

  @OneToMany(() => Message, (x) => x.inquiry)
  messages?: Relation<Message[]>;

  @OneToMany(() => ConsentRecord, (x) => x.inquiry)
  consents?: Relation<ConsentRecord[]>;
}

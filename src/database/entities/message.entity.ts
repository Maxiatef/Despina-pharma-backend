import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { Contact } from './contact.entity.js';
import { Inquiry } from './inquiry.entity.js';
import { Project } from './project.entity.js';
import { User } from './user.entity.js';

@Entity('messages')
export class Message extends BaseEntity {
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => Project, (x) => x.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Relation<Project> | null;

  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @ManyToOne(() => Inquiry, (x) => x.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry?: Relation<Inquiry> | null;

  @Column({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sender_id' })
  sender?: Relation<User> | null;

  @Column({ name: 'sender_contact_id', type: 'uuid', nullable: true })
  senderContactId: string | null;

  @ManyToOne(() => Contact, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sender_contact_id' })
  senderContact?: Relation<Contact> | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'via_email', default: false })
  viaEmail: boolean;
}

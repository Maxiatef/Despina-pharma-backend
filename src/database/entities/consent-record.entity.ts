import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { CONSENT_TYPES } from '../../common/enums.js';
import type { ConsentType } from '../../common/enums.js';
import { Contact } from './contact.entity.js';
import { Inquiry } from './inquiry.entity.js';

@Entity('consent_records')
export class ConsentRecord extends BaseEntity {
  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @ManyToOne(() => Contact, (x) => x.consents, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'contact_id' })
  contact?: Relation<Contact>;

  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @ManyToOne(() => Inquiry, (x) => x.consents, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry?: Relation<Inquiry> | null;

  @Column({ name: 'consent_type', type: 'enum', enum: CONSENT_TYPES, enumName: 'consent_type' })
  consentType: ConsentType;

  @Column({  })
  granted: boolean;

  @Column({ name: 'policy_version', type: 'varchar', length: 30, nullable: true })
  policyVersion: string | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;
}

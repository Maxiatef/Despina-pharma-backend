import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { Company } from './company.entity.js';
import { ConsentRecord } from './consent-record.entity.js';
import { Inquiry } from './inquiry.entity.js';
import { User } from './user.entity.js';

/** A person who contacted Despina. Separate from login credentials: visitors submit without an account. */
@Entity('contacts')
export class Contact extends BaseEntity {
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => Company, (x) => x.contacts, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'company_id' })
  company?: Relation<Company> | null;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 254 })
  email: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ name: 'job_title', type: 'varchar', length: 150, nullable: true })
  jobTitle: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string | null;

  @OneToMany(() => Inquiry, (x) => x.contact)
  inquiries?: Relation<Inquiry[]>;

  @OneToMany(() => ConsentRecord, (x) => x.contact)
  consents?: Relation<ConsentRecord[]>;

  @OneToMany(() => User, (x) => x.contact)
  users?: Relation<User[]>;
}

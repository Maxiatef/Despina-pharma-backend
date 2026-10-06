import { Column, Entity, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { CompanyMembership } from './company-membership.entity.js';
import { Contact } from './contact.entity.js';
import { Document } from './document.entity.js';
import { Inquiry } from './inquiry.entity.js';
import { Project } from './project.entity.js';

/** Customer company (brand). A visitor company is created from the public forms. */
@Entity('companies')
export class Company extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  website: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  industry: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => Contact, (x) => x.company)
  contacts?: Relation<Contact[]>;

  @OneToMany(() => CompanyMembership, (x) => x.company)
  memberships?: Relation<CompanyMembership[]>;

  @OneToMany(() => Inquiry, (x) => x.company)
  inquiries?: Relation<Inquiry[]>;

  @OneToMany(() => Project, (x) => x.company)
  projects?: Relation<Project[]>;

  @OneToMany(() => Document, (x) => x.company)
  documents?: Relation<Document[]>;
}

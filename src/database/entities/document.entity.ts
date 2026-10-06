import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { DOCUMENT_VISIBILITIES } from '../../common/enums.js';
import type { DocumentVisibility } from '../../common/enums.js';
import { Company } from './company.entity.js';
import { DocumentVersion } from './document-version.entity.js';
import { Inquiry } from './inquiry.entity.js';
import { Project } from './project.entity.js';
import { User } from './user.entity.js';

@Entity('documents')
export class Document extends BaseEntity {
  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @ManyToOne(() => Inquiry, (x) => x.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry?: Relation<Inquiry> | null;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => Project, (x) => x.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Relation<Project> | null;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => Company, (x) => x.documents, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'company_id' })
  company?: Relation<Company> | null;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedByUser?: Relation<User> | null;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'enum', enum: DOCUMENT_VISIBILITIES, enumName: 'document_visibility', default: 'internal' })
  visibility: DocumentVisibility;

  @OneToMany(() => DocumentVersion, (x) => x.document)
  versions?: Relation<DocumentVersion[]>;
}

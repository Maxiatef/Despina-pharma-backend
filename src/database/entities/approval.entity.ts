import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { APPROVAL_TARGETS, USER_ROLES } from '../../common/enums.js';
import type { ApprovalTarget, UserRole } from '../../common/enums.js';
import { BriefVersion } from './brief-version.entity.js';
import { DocumentVersion } from './document-version.entity.js';
import { Project } from './project.entity.js';
import { QuoteVersion } from './quote-version.entity.js';
import { SampleRevision } from './sample-revision.entity.js';
import { User } from './user.entity.js';

/** Approval bound to one immutable version + its hash. */
@Entity('approvals')
export class Approval extends BaseEntity {
  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (x) => x.approvals, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'project_id' })
  project?: Relation<Project>;

  @Column({ name: 'target_type', type: 'enum', enum: APPROVAL_TARGETS, enumName: 'approval_target' })
  targetType: ApprovalTarget;

  @Column({ name: 'document_version_id', type: 'uuid', nullable: true })
  documentVersionId: string | null;

  @ManyToOne(() => DocumentVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'document_version_id' })
  documentVersion?: Relation<DocumentVersion> | null;

  @Column({ name: 'sample_revision_id', type: 'uuid', nullable: true })
  sampleRevisionId: string | null;

  @ManyToOne(() => SampleRevision, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sample_revision_id' })
  sampleRevision?: Relation<SampleRevision> | null;

  @Column({ name: 'quote_version_id', type: 'uuid', nullable: true })
  quoteVersionId: string | null;

  @ManyToOne(() => QuoteVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'quote_version_id' })
  quoteVersion?: Relation<QuoteVersion> | null;

  @Column({ name: 'brief_version_id', type: 'uuid', nullable: true })
  briefVersionId: string | null;

  @ManyToOne(() => BriefVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'brief_version_id' })
  briefVersion?: Relation<BriefVersion> | null;

  @Column({ name: 'target_hash', type: 'char', length: 64 })
  targetHash: string;

  @Column({ name: 'approver_id', type: 'uuid' })
  approverId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'approver_id' })
  approver?: Relation<User>;

  @Column({ name: 'approver_role', type: 'enum', enum: USER_ROLES, enumName: 'user_role' })
  approverRole: UserRole;

  @Column({ name: 'confirmation_text', type: 'text' })
  confirmationText: string;

  @Column({ name: 'approved_at', type: 'timestamptz', default: () => 'now()' })
  approvedAt: Date;
}

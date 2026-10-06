import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { SCAN_STATUSES } from '../../common/enums.js';
import type { ScanStatus } from '../../common/enums.js';
import { Document } from './document.entity.js';
import { User } from './user.entity.js';

/** Immutable file version (approvals point at one exact version). */
@Entity('document_versions')
export class DocumentVersion extends BaseEntity {
  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => Document, (x) => x.versions, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'document_id' })
  document?: Relation<Document>;

  @Column({ name: 'version_no', type: 'int', default: 1 })
  versionNo: number;

  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey: string;

  @Column({ name: 'original_filename', type: 'varchar', length: 300 })
  originalFilename: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 150 })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes: string;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ name: 'scan_status', type: 'enum', enum: SCAN_STATUSES, enumName: 'scan_status', default: 'pending' })
  scanStatus: ScanStatus;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedByUser?: Relation<User> | null;
}

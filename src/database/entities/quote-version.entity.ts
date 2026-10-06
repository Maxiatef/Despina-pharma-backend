import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { DocumentVersion } from './document-version.entity.js';
import { Quote } from './quote.entity.js';
import { QuoteLine } from './quote-line.entity.js';

@Entity('quote_versions')
export class QuoteVersion extends BaseEntity {
  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @ManyToOne(() => Quote, (x) => x.versions, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'quote_id' })
  quote?: Relation<Quote>;

  @Column({ name: 'version_no', type: 'int', default: 1 })
  versionNo: number;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  total: string;

  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil: string | null;

  @Column({ name: 'document_version_id', type: 'uuid', nullable: true })
  documentVersionId: string | null;

  @ManyToOne(() => DocumentVersion, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'document_version_id' })
  documentVersion?: Relation<DocumentVersion> | null;

  @OneToMany(() => QuoteLine, (x) => x.quoteVersion)
  lines?: Relation<QuoteLine[]>;
}

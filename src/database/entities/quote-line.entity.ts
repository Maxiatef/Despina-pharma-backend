import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { ProjectProduct } from './project-product.entity.js';
import { QuoteVersion } from './quote-version.entity.js';

@Entity('quote_lines')
export class QuoteLine extends BaseEntity {
  @Column({ name: 'quote_version_id', type: 'uuid' })
  quoteVersionId: string;

  @ManyToOne(() => QuoteVersion, (x) => x.lines, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'quote_version_id' })
  quoteVersion?: Relation<QuoteVersion>;

  @Column({ name: 'project_product_id', type: 'uuid', nullable: true })
  projectProductId: string | null;

  @ManyToOne(() => ProjectProduct, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_product_id' })
  projectProduct?: Relation<ProjectProduct> | null;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 1 })
  quantity: string;

  @Column({ name: 'unit_price', type: 'numeric', precision: 14, scale: 4, default: 0 })
  unitPrice: string;

  @Column({ name: 'line_total', type: 'numeric', precision: 14, scale: 2, default: 0 })
  lineTotal: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}

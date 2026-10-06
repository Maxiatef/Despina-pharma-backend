import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { CATALOG_ITEM_KINDS } from '../../common/enums.js';
import type { CatalogItemKind } from '../../common/enums.js';
import { CatalogCategory } from './catalog-category.entity.js';
import { CatalogSource } from './catalog-source.entity.js';

export interface CatalogItemSourceRef {
  code: string;
  name: string;
  url: string | null;
  label: string | null;
  notes: string | null;
}

/** Catalog concept / reference product (972 delivered entries). */
@Entity('catalog_items')
export class CatalogItem extends BaseEntity {
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => CatalogCategory, (x) => x.items, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'category_id' })
  category?: Relation<CatalogCategory>;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId: string | null;

  @ManyToOne(() => CatalogSource, (x) => x.items, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_id' })
  source?: Relation<CatalogSource> | null;

  @Column({ type: 'varchar', length: 200 })
  slug: string;

  @Column({ type: 'varchar', length: 300 })
  name: string;

  @Column({ type: 'enum', enum: CATALOG_ITEM_KINDS, enumName: 'catalog_item_kind', default: 'stock-reference' })
  kind: CatalogItemKind;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subgroup: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  ingredients: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  sources: CatalogItemSourceRef[];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;

  @Column({ name: 'seo_title', type: 'varchar', length: 200, nullable: true })
  seoTitle: string | null;

  @Column({ name: 'seo_description', type: 'varchar', length: 400, nullable: true })
  seoDescription: string | null;

  @Column({ name: 'is_published', default: true })
  isPublished: boolean;
}

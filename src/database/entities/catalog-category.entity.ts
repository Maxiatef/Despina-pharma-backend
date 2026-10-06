import { Column, Entity, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { CatalogItem } from './catalog-item.entity.js';

@Entity('catalog_categories')
export class CatalogCategory extends BaseEntity {
  @Column({ type: 'varchar', length: 150 })
  slug: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_published', default: true })
  isPublished: boolean;

  @OneToMany(() => CatalogItem, (x) => x.category)
  items?: Relation<CatalogItem[]>;
}

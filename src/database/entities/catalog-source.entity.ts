import { Column, Entity, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { CatalogItem } from './catalog-item.entity.js';

/** Manufacturer reference source. Not Despina inventory. */
@Entity('catalog_sources')
export class CatalogSource extends BaseEntity {
  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  website: string | null;

  @OneToMany(() => CatalogItem, (x) => x.source)
  items?: Relation<CatalogItem[]>;
}

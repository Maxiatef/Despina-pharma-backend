import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { CatalogItem } from './catalog-item.entity.js';
import { Inquiry } from './inquiry.entity.js';
import { Service } from './service.entity.js';

/** Product / service context carried from the page the visitor came from. */
@Entity('inquiry_items')
export class InquiryItem extends BaseEntity {
  @Column({ name: 'inquiry_id', type: 'uuid' })
  inquiryId: string;

  @ManyToOne(() => Inquiry, (x) => x.items, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry?: Relation<Inquiry>;

  @Column({ name: 'catalog_item_id', type: 'uuid', nullable: true })
  catalogItemId: string | null;

  @ManyToOne(() => CatalogItem, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'catalog_item_id' })
  catalogItem?: Relation<CatalogItem> | null;

  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  @ManyToOne(() => Service, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_id' })
  service?: Relation<Service> | null;

  @Column({ type: 'int', nullable: true })
  quantity: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}

import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { Service } from './service.entity.js';

@Entity('faqs')
export class Faq extends BaseEntity {
  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  @ManyToOne(() => Service, (x) => x.faqs, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_id' })
  service?: Relation<Service> | null;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text' })
  answer: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  topic: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_published', default: true })
  isPublished: boolean;
}

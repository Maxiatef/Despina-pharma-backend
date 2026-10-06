import { Column, Entity } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';

@Entity('rate_limits')
export class RateLimit extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  key: string;

  @Column({ name: 'window_start', type: 'timestamptz' })
  windowStart: Date;

  @Column({ type: 'int', default: 0 })
  count: number;
}

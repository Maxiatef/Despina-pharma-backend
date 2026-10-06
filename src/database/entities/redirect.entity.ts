import { Column, Entity } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';

/** Old URL -> new URL, so published links keep working when slugs change. */
@Entity('redirects')
export class Redirect extends BaseEntity {
  @Column({ name: 'from_path', type: 'varchar', length: 500 })
  fromPath: string;

  @Column({ name: 'to_path', type: 'varchar', length: 500 })
  toPath: string;

  @Column({ name: 'status_code', type: 'smallint', default: 301 })
  statusCode: number;
}

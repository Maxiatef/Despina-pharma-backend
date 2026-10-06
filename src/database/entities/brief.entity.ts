import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { BriefVersion } from './brief-version.entity.js';
import { ProjectProduct } from './project-product.entity.js';

@Entity('briefs')
export class Brief extends BaseEntity {
  @Column({ name: 'project_product_id', type: 'uuid' })
  projectProductId: string;

  @ManyToOne(() => ProjectProduct, (x) => x.briefs, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'project_product_id' })
  projectProduct?: Relation<ProjectProduct>;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @OneToMany(() => BriefVersion, (x) => x.brief)
  versions?: Relation<BriefVersion[]>;
}

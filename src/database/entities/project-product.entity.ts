import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { Brief } from './brief.entity.js';
import { CatalogItem } from './catalog-item.entity.js';
import { Project } from './project.entity.js';
import { ProjectStage } from './project-stage.entity.js';
import { Sample } from './sample.entity.js';
import { Service } from './service.entity.js';

/** "Add to project" product line (a brief, not a shopping cart). */
@Entity('project_products')
export class ProjectProduct extends BaseEntity {
  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (x) => x.products, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'project_id' })
  project?: Relation<Project>;

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

  @Column({ type: 'varchar', length: 300 })
  name: string;

  @Column({ name: 'target_quantity', type: 'int', nullable: true })
  targetQuantity: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Current stage of this product line's own stage track (NULL until stages are started). */
  @Column({ name: 'current_stage_id', type: 'uuid', nullable: true })
  currentStageId: string | null;

  @ManyToOne(() => ProjectStage, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'current_stage_id' })
  currentStage?: Relation<ProjectStage> | null;

  @OneToMany(() => Brief, (x) => x.projectProduct)
  briefs?: Relation<Brief[]>;

  @OneToMany(() => Sample, (x) => x.projectProduct)
  samples?: Relation<Sample[]>;
}

import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { Brief } from './brief.entity.js';
import { CatalogItem } from './catalog-item.entity.js';
import { Project } from './project.entity.js';
import { ProjectStage } from './project-stage.entity.js';
import { Sample } from './sample.entity.js';
import { Service } from './service.entity.js';

/** Product-line brief fields (all optional); notSure = fields the customer has not decided yet. */
export interface ProductLineDetails {
  category?: string; format?: string; path?: string; quantity?: string; fillSize?: string;
  includeIngredients?: string; excludeIngredients?: string; texture?: string; fragrance?: string; color?: string; finish?: string;
  packaging?: string; artwork?: string; market?: string; channels?: string; launchDate?: string; budget?: string; references?: string;
  notSure?: string[];
}

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

  /** Internal target date (staff only). */
  @Column({ name: 'target_date', type: 'date', nullable: true })
  targetDate: string | null;

  /** Date committed to the customer (shown in the portal). */
  @Column({ name: 'promised_date', type: 'date', nullable: true })
  promisedDate: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Product-line brief: format, path, fill size, ingredients, texture, packaging, market, launch, budget, references, notSure[]. */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  details: ProductLineDetails;

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

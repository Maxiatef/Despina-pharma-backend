import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { SAMPLE_STATUSES } from '../../common/enums.js';
import type { SampleStatus } from '../../common/enums.js';
import { Inquiry } from './inquiry.entity.js';
import { ProjectProduct } from './project-product.entity.js';
import { SampleRevision } from './sample-revision.entity.js';

@Entity('samples')
export class Sample extends BaseEntity {
  @Column({ name: 'project_product_id', type: 'uuid' })
  projectProductId: string;

  @ManyToOne(() => ProjectProduct, (x) => x.samples, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'project_product_id' })
  projectProduct?: Relation<ProjectProduct>;

  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @ManyToOne(() => Inquiry, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry?: Relation<Inquiry> | null;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'enum', enum: SAMPLE_STATUSES, enumName: 'sample_status', default: 'requested' })
  status: SampleStatus;

  @OneToMany(() => SampleRevision, (x) => x.sample)
  revisions?: Relation<SampleRevision[]>;
}

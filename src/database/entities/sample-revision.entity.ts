import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { Feedback } from './feedback.entity.js';
import { Sample } from './sample.entity.js';
import { User } from './user.entity.js';

@Entity('sample_revisions')
export class SampleRevision extends BaseEntity {
  @Column({ name: 'sample_id', type: 'uuid' })
  sampleId: string;

  @ManyToOne(() => Sample, (x) => x.revisions, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'sample_id' })
  sample?: Relation<Sample>;

  @Column({ name: 'revision_no', type: 'int', default: 1 })
  revisionNo: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'shipped_at', type: 'timestamptz', nullable: true })
  shippedAt: Date | null;

  @Column({ name: 'tracking_no', type: 'varchar', length: 100, nullable: true })
  trackingNo: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser?: Relation<User> | null;

  @OneToMany(() => Feedback, (x) => x.sampleRevision)
  feedback?: Relation<Feedback[]>;
}

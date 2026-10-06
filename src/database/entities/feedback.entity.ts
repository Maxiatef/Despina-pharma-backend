import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { Inquiry } from './inquiry.entity.js';
import { SampleRevision } from './sample-revision.entity.js';
import { User } from './user.entity.js';

@Entity('feedback')
export class Feedback extends BaseEntity {
  @Column({ name: 'sample_revision_id', type: 'uuid' })
  sampleRevisionId: string;

  @ManyToOne(() => SampleRevision, (x) => x.feedback, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'sample_revision_id' })
  sampleRevision?: Relation<SampleRevision>;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author?: Relation<User> | null;

  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @ManyToOne(() => Inquiry, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry?: Relation<Inquiry> | null;

  @Column({ type: 'smallint', nullable: true })
  rating: number | null;

  @Column({ type: 'text', nullable: true })
  comments: string | null;
}

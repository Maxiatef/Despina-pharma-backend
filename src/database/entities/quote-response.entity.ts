import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { QUOTE_RESPONSES } from '../../common/enums.js';
import type { QuoteResponseDecision } from '../../common/enums.js';
import { Quote } from './quote.entity.js';
import { QuoteVersion } from './quote-version.entity.js';
import { User } from './user.entity.js';

/** A customer's answer to one exact quote version: declined, or changes requested (acceptance is an Approval). */
@Entity('quote_responses')
export class QuoteResponse extends BaseEntity {
  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @ManyToOne(() => Quote, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'quote_id' })
  quote?: Relation<Quote>;

  @Column({ name: 'quote_version_id', type: 'uuid' })
  quoteVersionId: string;

  @ManyToOne(() => QuoteVersion, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'quote_version_id' })
  quoteVersion?: Relation<QuoteVersion>;

  @Column({ type: 'enum', enum: QUOTE_RESPONSES, enumName: 'quote_response_decision' })
  decision: QuoteResponseDecision;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'responded_by', type: 'uuid', nullable: true })
  respondedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'responded_by' })
  respondedByUser?: Relation<User> | null;
}

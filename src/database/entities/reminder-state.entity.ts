import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity.js';

/**
 * One row per item that waits on the customer (quote to answer, sample to rate, lead with a question).
 * item_key includes the version/revision, so a new quote version or sample revision starts a fresh count.
 * The row is removed as soon as the item stops waiting.
 */
@Entity('reminder_states')
export class ReminderState extends BaseEntity {
  @Column({ name: 'item_key', type: 'varchar', length: 120, unique: true })
  itemKey: string;

  @Column({ name: 'item_type', type: 'varchar', length: 20 })
  itemType: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @Column({ name: 'waiting_since', type: 'timestamptz' })
  waitingSince: Date;

  @Column({ name: 'sent_count', type: 'int', default: 0 })
  sentCount: number;

  @Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
  lastSentAt: Date | null;

  @Column({ name: 'paused_at', type: 'timestamptz', nullable: true })
  pausedAt: Date | null;

  @Column({ name: 'paused_by', type: 'uuid', nullable: true })
  pausedBy: string | null;
}

import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { TASK_PRIORITIES } from '../../common/enums.js';
import type { TaskPriority } from '../../common/enums.js';
import { Inquiry } from './inquiry.entity.js';
import { Project } from './project.entity.js';
import { User } from './user.entity.js';

/** Follow-up task (overdue tasks trigger reminders). */
@Entity('tasks')
export class Task extends BaseEntity {
  @Column({ name: 'inquiry_id', type: 'uuid', nullable: true })
  inquiryId: string | null;

  @ManyToOne(() => Inquiry, (x) => x.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry?: Relation<Inquiry> | null;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => Project, (x) => x.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Relation<Project> | null;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_id' })
  assignee?: Relation<User> | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser?: Relation<User> | null;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'enum', enum: TASK_PRIORITIES, enumName: 'task_priority', default: 'normal' })
  priority: TaskPriority;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}

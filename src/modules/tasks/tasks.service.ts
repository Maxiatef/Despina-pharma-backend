import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Task } from '../../database/entities/index.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { paged } from '../../common/utils.js';
import { EmailService } from '../email/email.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CreateTaskDto, TaskQueryDto, UpdateTaskDto } from './dto/task.dto.js';

@Injectable()
export class TasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TasksService.name);
  private timer?: NodeJS.Timeout;
  private lastDigestDay = '';

  constructor(
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly ds: DataSource,
    private readonly email: EmailService,
    private readonly rateLimit: RateLimitService,
    private readonly auth: AuthService,
  ) {}

  onModuleInit() {
    // Hourly tick: sends the daily overdue digest once per day at TASK_REMINDER_HOUR (server time),
    // and cleans up old rate-limit rows and expired sessions.
    // On Vercel (serverless) Vercel Cron calls /api/cron/run instead of this timer.
    if (!process.env.VERCEL) this.timer = setInterval(() => void this.tick(), 3_600_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      await this.rateLimit.cleanup();
      await this.auth.purgeExpiredSessions();
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (now.getHours() === Number(process.env.TASK_REMINDER_HOUR ?? 8) && this.lastDigestDay !== day) {
        this.lastDigestDay = day;
        await this.sendOverdueDigest();
      }
    } catch (err) {
      this.logger.error((err as Error).message);
    }
  }

  /** One email per staff member listing their overdue tasks. */
  async sendOverdueDigest() {
    const rows: { email: string; titles: string[] }[] = await this.ds.query(`
      SELECT u.email, array_agg(t.title || ' (due ' || to_char(t.due_at, 'YYYY-MM-DD') || ')' ORDER BY t.due_at) AS titles
      FROM tasks t JOIN users u ON u.id = t.assignee_id
      WHERE t.completed_at IS NULL AND t.due_at < now() AND u.is_active
      GROUP BY u.email`);
    for (const r of rows) {
      await this.email.queue({
        kind: 'staff_alert', to: r.email, template: 'staff_alert',
        data: { title: `${r.titles.length} overdue follow-up task(s)`, body: r.titles.map((t) => `• ${t}`).join('\n') },
      });
    }
    return { sent: rows.length };
  }

  async list(q: TaskQueryDto, user: AuthUser) {
    const qb = this.tasks.createQueryBuilder('t').skip((q.page - 1) * q.pageSize).take(q.pageSize).orderBy('t.dueAt', 'ASC', 'NULLS LAST');
    if (q.assignee) qb.andWhere('t.assigneeId = :a', { a: q.assignee === 'me' ? user.id : q.assignee });
    if (q.inquiryId) qb.andWhere('t.inquiryId = :i', { i: q.inquiryId });
    if (q.projectId) qb.andWhere('t.projectId = :p', { p: q.projectId });
    if (q.q) qb.andWhere('t.title ILIKE :q', { q: `%${q.q}%` });
    const state = q.state ?? 'open';
    if (state === 'open') qb.andWhere('t.completedAt IS NULL');
    if (state === 'done') qb.andWhere('t.completedAt IS NOT NULL');
    if (state === 'overdue') qb.andWhere('t.completedAt IS NULL AND t.dueAt < now()');
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, q);
  }

  async create(dto: CreateTaskDto, user: AuthUser) {
    if (!dto.inquiryId && !dto.projectId) throw new BadRequestException('inquiryId or projectId is required');
    return this.tasks.save(this.tasks.create({ ...dto, dueAt: dto.dueAt ? new Date(dto.dueAt) : null, assigneeId: dto.assigneeId ?? user.id, createdBy: user.id }));
  }

  async update(id: string, dto: UpdateTaskDto) {
    const task = await this.tasks.findOneBy({ id });
    if (!task) throw new NotFoundException('Task not found');
    return this.tasks.save(this.tasks.merge(task, { ...dto, dueAt: dto.dueAt ? new Date(dto.dueAt) : task.dueAt }));
  }

  async setDone(id: string, done: boolean) {
    const task = await this.tasks.findOneBy({ id });
    if (!task) throw new NotFoundException('Task not found');
    task.completedAt = done ? new Date() : null;
    return this.tasks.save(task);
  }

  async remove(id: string) {
    await this.tasks.delete(id);
    return { ok: true };
  }
}

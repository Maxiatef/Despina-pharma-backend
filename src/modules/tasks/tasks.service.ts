import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Company, Contact, Inquiry, Project, Task, User } from '../../database/entities/index.js';
import { STAFF_ROLES } from '../../common/enums.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { paged } from '../../common/utils.js';
import { EmailService } from '../email/email.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CreateTaskDto, TaskQueryDto, UpdateTaskDto } from './dto/task.dto.js';
import { AuditService } from '../audit/audit.service.js';

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
    private readonly audit: AuditService,
  ) {}

  /** Tasks can only belong to active staff. */
  private async staffUser(userId: string) {
    const user = await this.ds.getRepository(User).findOneBy({ id: userId, isActive: true });
    if (!user || !STAFF_ROLES.includes(user.role)) throw new ForbiddenException('Tasks can only be assigned to active staff');
    return user;
  }

  /** Tell the new owner (queued until e-mail sending is connected). Not sent when you assign a task to yourself. */
  private async notifyAssignee(task: Task, user: User, actorId: string) {
    if (user.id === actorId) return;
    const [ref] = await this.ds.query(
      `SELECT i.reference_no, p.code FROM tasks t LEFT JOIN inquiries i ON i.id = t.inquiry_id LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = $1`, [task.id]);
    const where = task.inquiryId ? `/admin/inquiries/${task.inquiryId}` : task.projectId ? `/admin/projects/${task.projectId}` : '/admin/tasks';
    await this.email.queue({
      kind: 'staff_alert', to: user.email, template: 'staff_alert', inquiryId: task.inquiryId ?? undefined, projectId: task.projectId ?? undefined,
      data: {
        title: `Task assigned to you: ${task.title}`,
        body: [ref?.reference_no || ref?.code ? `For: ${ref.reference_no ?? ref.code}` : '', task.dueAt ? `Due: ${new Date(task.dueAt).toUTCString()}` : '',
          `Open: ${process.env.APP_URL ?? ''}${where}`].filter(Boolean).join('\n'),
      },
    });
  }

  /** Assign, reassign or unassign (userId null). */
  async assign(id: string, userId: string | null, actor: AuthUser) {
    const task = await this.tasks.findOneBy({ id });
    if (!task) throw new NotFoundException('Task not found');
    const user = userId ? await this.staffUser(userId) : null;
    if (task.assigneeId === (user?.id ?? null)) return task;
    task.assigneeId = user?.id ?? null;
    const saved = await this.tasks.save(task);
    if (user) await this.notifyAssignee(saved, user, actor.id);
    return saved;
  }

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
    const qb = this.tasks
      .createQueryBuilder('t')
      .leftJoin(Inquiry, 'i', 'i.id = t.inquiryId')
      .leftJoin(Contact, 'ct', 'ct.id = i.contactId')
      .leftJoin(Project, 'p', 'p.id = t.projectId')
      .leftJoin(Company, 'co', 'co.id = coalesce(p.companyId, i.companyId)')
      .addSelect(['i.referenceNo', 'i.status', 'p.code', 'p.name', 'co.name', 'ct.firstName', 'ct.lastName'])
      .skip((q.page - 1) * q.pageSize).take(q.pageSize).orderBy('t.dueAt', 'ASC', 'NULLS LAST');
    if (q.assignee === 'unassigned') qb.andWhere('t.assigneeId IS NULL');
    else if (q.assignee) qb.andWhere('t.assigneeId = :a', { a: q.assignee === 'me' ? user.id : q.assignee });
    if (q.inquiryId) qb.andWhere('t.inquiryId = :i', { i: q.inquiryId });
    if (q.projectId) qb.andWhere('t.projectId = :p', { p: q.projectId });
    if (q.q) qb.andWhere('t.title ILIKE :q', { q: `%${q.q}%` });
    const state = q.state ?? 'open';
    if (state === 'open') qb.andWhere('t.completedAt IS NULL');
    if (state === 'done') qb.andWhere('t.completedAt IS NOT NULL');
    if (state === 'overdue') qb.andWhere('t.completedAt IS NULL AND t.dueAt < now()');
    const [{ entities, raw }, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);
    const items = entities.map((t) => {
      const r = raw.find((x) => x.t_id === t.id) ?? {};
      return {
        ...t,
        inquiryRef: r.i_reference_no ?? null, inquiryStatus: r.i_status ?? null, projectCode: r.p_code ?? null,
        projectName: r.p_name ?? null, companyName: r.co_name ?? null,
        contactName: [r.ct_first_name, r.ct_last_name].filter(Boolean).join(' ') || null,
      };
    });
    return paged(items, total, q);
  }

  async create(dto: CreateTaskDto, user: AuthUser) {
    if (!dto.inquiryId && !dto.projectId) throw new BadRequestException('inquiryId or projectId is required');
    if (dto.assigneeId && dto.assigneeId !== user.id) {
      const assignee = await this.staffUser(dto.assigneeId);
      const task = await this.tasks.save(this.tasks.create({ ...dto, dueAt: dto.dueAt ? new Date(dto.dueAt) : null, createdBy: user.id }));
      await this.notifyAssignee(task, assignee, user.id);
      return task;
    }
    return this.tasks.save(this.tasks.create({ ...dto, dueAt: dto.dueAt ? new Date(dto.dueAt) : null, assigneeId: dto.assigneeId ?? user.id, createdBy: user.id }));
  }

  async update(id: string, dto: UpdateTaskDto) {
    const task = await this.tasks.findOneBy({ id });
    if (!task) throw new NotFoundException('Task not found');
    if (dto.assigneeId) await this.staffUser(dto.assigneeId);
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

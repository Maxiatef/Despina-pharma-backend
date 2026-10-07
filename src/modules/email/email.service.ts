import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, Repository } from 'typeorm';
import { EmailEvent, EmailJob } from '../../database/entities/index.js';
import type { EmailEventType, EmailKind } from '../../common/enums.js';
import { EmailProvider } from './providers/email.provider.js';
import { renderTemplate } from './email.templates.js';
import type { TemplateName } from './email.templates.js';

export interface QueueEmailInput {
  kind: EmailKind;
  to: string;
  template: TemplateName;
  data: Record<string, unknown>;
  inquiryId?: string | null;
  projectId?: string | null;
}

const MAX_ATTEMPTS = 5;
const NO_PROVIDER = 'No email provider configured (EMAIL_PROVIDER=none)';

/**
 * Emails are written to email_jobs first (inside the caller's transaction when given),
 * then sent by a background loop. If sending fails, the inquiry is still saved and
 * the job keeps its error so staff can retry it.
 */
@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(EmailJob) private readonly jobs: Repository<EmailJob>,
    @InjectRepository(EmailEvent) private readonly events: Repository<EmailEvent>,
    private readonly provider: EmailProvider,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const seconds = Number(this.config.get('EMAIL_WORKER_INTERVAL_SECONDS') ?? 30);
    // On Vercel (serverless) there is no long-running process: Vercel Cron calls /api/cron/run instead.
    if (seconds > 0 && !process.env.VERCEL) this.timer = setInterval(() => void this.processQueue(), seconds * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  get ownerEmail() {
    return this.config.get<string>('OWNER_NOTIFICATION_EMAIL') ?? '';
  }

  async queue(input: QueueEmailInput, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(EmailJob) : this.jobs;
    const rendered = renderTemplate(input.template, input.data, this.config.get('APP_URL') ?? '');
    const job = await repo.save(
      repo.create({
        kind: input.kind,
        toEmail: input.to,
        subject: rendered.subject.slice(0, 300),
        bodyText: rendered.text,
        inquiryId: input.inquiryId ?? null,
        projectId: input.projectId ?? null,
        status: 'queued',
      }),
    );
    return job;
  }

  async processQueue() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.jobs.find({
        where: { status: In(['queued', 'failed']), attempts: LessThan(MAX_ATTEMPTS) },
        order: { createdAt: 'ASC' },
        take: 20,
      });
      for (const job of due) await this.sendJob(job);
    } catch (err) {
      this.logger.error(`Email queue error: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sendJob(job: EmailJob) {
    // TODO(resend): while EMAIL_PROVIDER=none, jobs stay "queued" so they can be sent once Resend is connected.
    if (this.provider.name === 'none') {
      if (!job.lastError) {
        await this.provider.send({ to: job.toEmail, subject: job.subject, text: job.bodyText ?? '' });
        await this.jobs.update(job.id, { lastError: NO_PROVIDER });
      }
      return;
    }

    await this.jobs.update(job.id, { status: 'sending', attempts: job.attempts + 1 });
    try {
      const result = await this.provider.send({
        to: job.toEmail,
        subject: job.subject,
        text: job.bodyText ?? job.subject,
        replyTo: this.config.get('EMAIL_REPLY_TO') || undefined,
      });
      await this.jobs.update(job.id, {
        status: 'sent',
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        lastError: null,
      });
    } catch (err) {
      await this.jobs.update(job.id, { status: 'failed', lastError: (err as Error).message.slice(0, 2000) });
    }
  }

  async retry(jobId: string) {
    await this.jobs.update(jobId, { status: 'queued', attempts: 0, lastError: null });
    void this.processQueue();
    return this.jobs.findOneByOrFail({ id: jobId });
  }

  list(filter: { status?: string; inquiryId?: string; projectId?: string }, skip: number, take: number) {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.inquiryId) where.inquiryId = filter.inquiryId;
    if (filter.projectId) where.projectId = filter.projectId;
    return this.jobs.findAndCount({ where, order: { createdAt: 'DESC' }, skip, take });
  }

  eventsFor(jobId: string) {
    return this.events.find({ where: { emailJobId: jobId }, order: { occurredAt: 'ASC' } });
  }

  /** Record a delivery event reported by the provider webhook. */
  async recordEvent(providerMessageId: string, event: EmailEventType, raw: Record<string, unknown>, occurredAt?: Date) {
    const job = await this.jobs.findOne({ where: { providerMessageId } });
    if (!job) return null;
    if (event === 'bounced' || event === 'failed' || event === 'complaint') {
      await this.jobs.update(job.id, { lastError: `Provider reported: ${event}` });
    }
    return this.events.save(this.events.create({ emailJobId: job.id, event, raw, occurredAt: occurredAt ?? new Date() }));
  }
}

import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { EmailEvent, EmailJob } from '../../database/entities/index.js';
import type { EmailEventType, EmailKind } from '../../common/enums.js';
import { SettingsService } from '../settings/settings.service.js';
import { EmailProvider } from './providers/email.provider.js';
import { renderTemplate } from './email.templates.js';
import type { TemplateName } from './email.templates.js';
import { currentRequestId } from '../../common/request-context.js';
import { emailRequestContext } from './email-context.js';
import {
  CUSTOMER_EMAILS, SETTING_KEYS, STAFF_NOTIFICATIONS, isUndeliverableTestAddress, isValidEmail, parseRecipients,
} from './email-settings.js';
import type { CustomerEmailKey, StaffNotificationKey } from './email-settings.js';

export interface QueueEmailInput {
  kind: EmailKind;
  to: string;
  template: TemplateName;
  data: Record<string, unknown>;
  inquiryId?: string | null;
  projectId?: string | null;
}

interface Links {
  inquiryId?: string | null;
  projectId?: string | null;
}

const MAX_ATTEMPTS = 5;
const TEST_DATA = /@[\w.-]+\.invalid\b/i;

/**
 * Every e-mail is written to email_jobs first (inside the caller's transaction when given), then sent:
 *  - right after the request succeeded (EmailFlushInterceptor),
 *  - else / on failure by the queue (every EMAIL_WORKER_INTERVAL_SECONDS locally, /api/cron on Vercel),
 *    with back-off, up to 5 attempts; a final failure alerts the "e-mail failure" recipients.
 * Nothing is sent to test addresses (.invalid …), to addresses that bounced, or when switched off in
 * Admin → Settings → Emails – those jobs are stored as "skipped" with the reason.
 */
@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(EmailJob) private readonly jobs: Repository<EmailJob>,
    @InjectRepository(EmailEvent) private readonly events: Repository<EmailEvent>,
    private readonly ds: DataSource,
    private readonly provider: EmailProvider,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    const seconds = Number(this.config.get('EMAIL_WORKER_INTERVAL_SECONDS') ?? 30);
    // On Vercel there is no long-running process: the request flush + Vercel Cron (/api/cron/run) cover it.
    if (seconds > 0 && !process.env.VERCEL) this.timer = setInterval(() => void this.processQueue(), seconds * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  get providerName() {
    return this.provider.name;
  }

  get appUrl() {
    return (this.config.get<string>('APP_URL') ?? '').replace(/\/$/, '');
  }

  /** .env fallback for staff notifications that have no recipient set in Settings. */
  get ownerEmail() {
    return this.config.get<string>('OWNER_NOTIFICATION_EMAIL') ?? '';
  }

  // =================================================================== sender identity
  async sender() {
    const env = String(this.config.get('EMAIL_FROM') ?? '');
    const m = env.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    const envName = m?.[1]?.trim() || 'Despina Pharma';
    const envEmail = m?.[2]?.trim() || (isValidEmail(env) ? env.trim() : 'onboarding@resend.dev');
    const name = ((await this.settings.get(SETTING_KEYS.senderName)) || envName).replace(/["<>]/g, '');
    const email = (await this.settings.get(SETTING_KEYS.senderEmail)) || envEmail;
    const replyTo = (await this.settings.get(SETTING_KEYS.replyTo)) || this.config.get<string>('EMAIL_REPLY_TO') || '';
    return { name, email, replyTo, from: `${name} <${email}>` };
  }

  // =================================================================== what to send
  /**
   * Staff notification controlled in Settings: switch + recipient list, plus `people` (assignee / project owner)
   * when the notification is addressed to a person.
   */
  async notifyStaff(key: StaffNotificationKey, template: TemplateName, data: Record<string, unknown>,
    opts: Links & { people?: (string | null | undefined)[]; manager?: EntityManager } = {}) {
    if (!(await this.settings.isOn(SETTING_KEYS.notifyEnabled(key)))) return [];
    const def = STAFF_NOTIFICATIONS.find((n) => n.key === key)!;
    const to = new Set<string>();
    if (def.recipients !== 'person') {
      const stored = await this.settings.get(SETTING_KEYS.notifyTo(key));
      const fallback = (def.envFallback && this.config.get<string>(def.envFallback)) || this.ownerEmail;
      for (const e of parseRecipients(stored ?? fallback)) to.add(e);
    }
    if (def.recipients !== 'list') for (const p of opts.people ?? []) if (p && isValidEmail(p)) to.add(p.toLowerCase());
    const kind: EmailKind = key.startsWith('inquiry.') ? 'owner_notice' : 'staff_notice';
    const out: EmailJob[] = [];
    for (const address of to) out.push(await this.queue({ kind, to: address, template, data, ...opts }, opts.manager));
    return out;
  }

  /** E-mail to a customer, if that e-mail type is switched on in Settings. */
  async toCustomer(key: CustomerEmailKey, to: string | null | undefined, template: TemplateName, data: Record<string, unknown>,
    opts: Links & { manager?: EntityManager } = {}) {
    if (!to || !(await this.settings.isOn(SETTING_KEYS.customerEnabled(key)))) return null;
    const kind: EmailKind = key === 'inquiry_ack' ? 'customer_ack' : key === 'quote_ready' ? 'quote_notice' : key === 'reply' ? 'message_notice' : 'customer_notice';
    return this.queue({ kind, to, template, data, ...opts }, opts.manager);
  }

  /** Is this customer e-mail type switched on? (e.g. to tell the website form whether a confirmation follows) */
  async customerEmailOn(key: CustomerEmailKey) {
    return this.provider.name !== 'none' && (await this.settings.isOn(SETTING_KEYS.enabled)) && (await this.settings.isOn(SETTING_KEYS.customerEnabled(key)));
  }

  /**
   * Writes the e-mail (rendered now, so it shows exactly what was sent). Returns the job; it is sent after the
   * request or by the queue. Account e-mails (invite, password reset) ignore the master switch.
   */
  async queue(input: QueueEmailInput, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(EmailJob) : this.jobs;
    const rendered = renderTemplate(input.template, input.data, this.appUrl);
    const skip = await this.skipReason(input, manager);
    const job = await repo.save(
      repo.create({
        kind: input.kind,
        template: input.template,
        toEmail: input.to.trim().slice(0, 254),
        subject: rendered.subject.slice(0, 300),
        bodyText: rendered.text,
        bodyHtml: rendered.html,
        inquiryId: input.inquiryId ?? null,
        projectId: input.projectId ?? null,
        requestId: currentRequestId(),
        status: skip ? 'skipped' : 'queued',
        lastError: skip,
      }),
    );
    if (!skip) emailRequestContext.getStore()?.jobIds.push(job.id);
    await this.notifyInApp(input, rendered.subject, manager);
    return job;
  }

  /**
   * The same event also shows on the website bell, when the address belongs to someone with a login.
   * Written even when the e-mail itself is skipped (switched off, test address). Never fails the action.
   */
  private async notifyInApp(input: QueueEmailInput, title: string, manager?: EntityManager) {
    if (['invite', 'password_reset', 'test', 'customer_ack'].includes(input.kind)) return;
    try {
      const q = (manager ?? this.ds.manager).query.bind(manager ?? this.ds.manager);
      const [user] = await q(`SELECT id, role FROM users WHERE lower(email) = lower($1) AND is_active`, [input.to.trim()]);
      if (!user) return;
      const customer = user.role === 'customer';
      const link = input.projectId ? `/${customer ? 'portal' : 'admin'}/projects/${input.projectId}/`
        : input.inquiryId && !customer ? `/admin/inquiries/${input.inquiryId}/` : customer ? '/portal/' : '/admin/';
      const section = SECTION[input.template];
      const target = section && (input.projectId || input.inquiryId) ? `${link}#${section}` : link;
      await q(`INSERT INTO notifications (user_id, title, link, project_id, inquiry_id) VALUES ($1, $2, $3, $4, $5)`,
        [user.id, title.slice(0, 300), target, input.projectId ?? null, input.inquiryId ?? null]);
    } catch (e) {
      this.logger.warn(`In-app notification not saved: ${(e as Error).message}`);
    }
  }

  private async skipReason(input: QueueEmailInput, manager?: EntityManager): Promise<string | null> {
    if (!isValidEmail(input.to)) return 'Not sent: invalid e-mail address';
    if (isUndeliverableTestAddress(input.to)) return 'Not sent: test address (.invalid / .test / example)';
    // Notifications about a test customer (smoke tests use @….invalid contacts) are not sent either.
    const about = [input.data.contactEmail, input.data.customerEmail].filter((v): v is string => typeof v === 'string');
    if (input.kind !== 'test' && about.some((e) => TEST_DATA.test(e))) return 'Not sent: about test data (@….invalid)';
    const account = input.kind === 'invite' || input.kind === 'password_reset' || input.kind === 'test';
    if (!account && !(await this.settings.isOn(SETTING_KEYS.enabled))) return 'Not sent: e-mail sending is switched off in Settings → Emails';
    const [bounced] = await (manager ?? this.ds.manager).query(
      `SELECT email_status FROM contacts WHERE lower(email) = lower($1) AND email_status IS NOT NULL LIMIT 1`, [input.to],
    );
    if (bounced && !account) return `Not sent: this address ${bounced.email_status} earlier (clear it on the contact to send again)`;
    return null;
  }

  // =================================================================== sending
  /** Send these jobs now (called after a successful request). */
  async sendNow(ids: string[]) {
    if (this.provider.name === 'none') return;
    for (const id of ids) {
      const job = await this.claim(id);
      if (job) await this.deliver(job);
    }
  }

  /** Atomically marks a job as "sending" so the request flush and the queue never send it twice. */
  private async claim(id: string): Promise<EmailJob | null> {
    const [rows] = await this.ds.query(
      `UPDATE email_jobs SET status = 'sending', attempts = attempts + 1, updated_at = now()
       WHERE id = $1 AND status IN ('queued', 'failed') AND attempts < $2 RETURNING id`,
      [id, MAX_ATTEMPTS],
    );
    return rows?.length ? this.jobs.findOneBy({ id }) : null;
  }

  async processQueue() {
    if (this.running || this.provider.name === 'none') return;
    this.running = true;
    try {
      // Queued jobs, failed jobs whose back-off has passed, and jobs stuck in "sending" for 10+ minutes (crashed instance).
      const due: { id: string }[] = await this.ds.query(
        `SELECT id FROM email_jobs
         WHERE attempts < $1 AND (
           status = 'queued'
           OR (status = 'failed' AND updated_at < now() - make_interval(mins => (ARRAY[0,2,10,30,120])[LEAST(attempts, 4) + 1]))
           OR (status = 'sending' AND updated_at < now() - interval '10 minutes'))
         ORDER BY created_at LIMIT 20`,
        [MAX_ATTEMPTS],
      );
      for (const { id } of due) {
        await this.ds.query(`UPDATE email_jobs SET status = 'queued' WHERE id = $1 AND status = 'sending' AND updated_at < now() - interval '10 minutes'`, [id]);
        const job = await this.claim(id);
        if (job) await this.deliver(job);
      }
    } catch (err) {
      this.logger.error(`Email queue error: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async deliver(job: EmailJob) {
    const sender = await this.sender();
    try {
      const result = await this.provider.send({
        from: sender.from,
        to: job.toEmail,
        subject: job.subject,
        text: job.bodyText ?? job.subject,
        html: job.bodyHtml,
        replyTo: sender.replyTo || undefined,
        tags: [{ name: 'kind', value: job.kind }, { name: 'template', value: job.template ?? 'none' }],
      });
      await this.jobs.update(job.id, { status: 'sent', sentAt: new Date(), providerMessageId: result.providerMessageId, lastError: null });
      this.logger.log(`sent ${job.template ?? job.kind} to ${job.toEmail} (${result.providerMessageId ?? 'no id'})`);
    } catch (err) {
      const message = (err as Error).message.slice(0, 2000);
      await this.jobs.update(job.id, { status: 'failed', lastError: message });
      this.logger.warn(`${job.requestId ? `[${job.requestId}] ` : ''}could not send ${job.template ?? job.kind} to ${job.toEmail} (attempt ${job.attempts}/${MAX_ATTEMPTS}): ${message}`);
      if (job.attempts >= MAX_ATTEMPTS) await this.alertFailure({ ...job, lastError: message });
    }
  }

  /** Tell the "e-mail failure" recipients – never about a failure alert itself (no loops). */
  private async alertFailure(job: Pick<EmailJob, 'toEmail' | 'subject' | 'lastError' | 'attempts' | 'template' | 'inquiryId' | 'projectId'>) {
    if (job.template === 'failure_alert') return;
    await this.notifyStaff('email.failure', 'failure_alert',
      { toEmail: job.toEmail, subject: job.subject, error: job.lastError, attempts: job.attempts },
      { inquiryId: job.inquiryId, projectId: job.projectId });
  }

  async retry(jobId: string) {
    await this.jobs.update(jobId, { status: 'queued', attempts: 0, lastError: null });
    await this.sendNow([jobId]);
    return this.jobs.findOneByOrFail({ id: jobId });
  }

  /** Admin "Send test e-mail": sent immediately, the result (sent / error) is returned. */
  async sendTest(to: string, requestedBy: string) {
    const sender = await this.sender();
    const job = await this.queue({ kind: 'test', to, template: 'test', data: { requestedBy, sender: sender.from } });
    if (job.status === 'queued') {
      const claimed = await this.claim(job.id);
      if (claimed) await this.deliver(claimed);
    }
    return this.jobs.findOneByOrFail({ id: job.id });
  }

  async getJob(id: string) {
    const job = await this.jobs.findOneBy({ id });
    if (!job) throw new NotFoundException('E-mail not found');
    return job;
  }

  list(filter: { status?: string; inquiryId?: string; projectId?: string; kind?: string; q?: string }, skip: number, take: number) {
    // The list leaves out the bodies; GET /email-jobs/:id returns the full e-mail.
    const qb = this.jobs.createQueryBuilder('j')
      .select(['j.id', 'j.createdAt', 'j.updatedAt', 'j.kind', 'j.template', 'j.toEmail', 'j.subject', 'j.status', 'j.attempts',
        'j.lastError', 'j.sentAt', 'j.providerMessageId', 'j.inquiryId', 'j.projectId', 'j.lastEvent', 'j.lastEventAt'])
      .orderBy('j.createdAt', 'DESC').skip(skip).take(take);
    if (filter.status) qb.andWhere('j.status = :s', { s: filter.status });
    if (filter.inquiryId) qb.andWhere('j.inquiryId = :i', { i: filter.inquiryId });
    if (filter.projectId) qb.andWhere('j.projectId = :p', { p: filter.projectId });
    if (filter.kind) qb.andWhere('j.kind = :k', { k: filter.kind });
    if (filter.q) qb.andWhere('(j.toEmail ILIKE :q OR j.subject ILIKE :q)', { q: `%${filter.q}%` });
    return qb.getManyAndCount();
  }

  eventsFor(jobId: string) {
    return this.events.find({ where: { emailJobId: jobId }, order: { occurredAt: 'ASC' } });
  }

  // =================================================================== delivery events (Resend webhook)
  async recordEvent(providerMessageId: string, event: EmailEventType, raw: Record<string, unknown>, occurredAt = new Date()) {
    const job = await this.jobs.findOne({ where: { providerMessageId } });
    if (!job) return null;
    const saved = await this.events.save(this.events.create({ emailJobId: job.id, event, raw, occurredAt }));
    await this.jobs.update(job.id, {
      lastEvent: event, lastEventAt: occurredAt,
      ...(event === 'bounced' || event === 'complaint' || event === 'failed' ? { lastError: `Resend reported: ${event}${detail(raw) ? ` – ${detail(raw)}` : ''}` } : {}),
    });
    if (event === 'bounced' || event === 'complaint') {
      // Do not e-mail this address again until staff clear it on the contact.
      await this.ds.query(
        `UPDATE contacts SET email_status = $2, email_status_at = $3, email_status_detail = $4 WHERE lower(email) = lower($1)`,
        [job.toEmail, event === 'bounced' ? 'bounced' : 'complained', occurredAt, detail(raw) || null],
      );
      if (event === 'bounced') await this.alertFailure({ ...job, lastError: `Bounced${detail(raw) ? `: ${detail(raw)}` : ''}` });
    }
    return saved;
  }

  // =================================================================== status for the settings page
  async status() {
    const sender = await this.sender();
    const [counts] = await this.ds.query(`
      SELECT count(*) FILTER (WHERE status = 'sent' AND created_at > now() - interval '30 days')::int AS sent,
             count(*) FILTER (WHERE status = 'failed')::int AS failed,
             count(*) FILTER (WHERE status IN ('queued', 'sending'))::int AS waiting,
             count(*) FILTER (WHERE status = 'skipped' AND created_at > now() - interval '30 days')::int AS skipped
      FROM email_jobs`);
    return {
      provider: this.provider.name,
      resendKeySet: !!process.env.RESEND_API_KEY,
      webhookSecretSet: !!process.env.RESEND_WEBHOOK_SECRET,
      webhookUrl: `${String(this.config.get('API_PUBLIC_URL') ?? this.appUrl).replace(/\/$/, '')}/api/webhooks/email-events`,
      sendingEnabled: await this.settings.isOn(SETTING_KEYS.enabled),
      sender,
      onboardingSender: sender.email.toLowerCase() === 'onboarding@resend.dev',
      fallbackRecipient: this.ownerEmail || null,
      counts,
      customerEmails: CUSTOMER_EMAILS.length,
      staffNotifications: STAFF_NOTIFICATIONS.length,
    };
  }
}

function detail(raw: Record<string, unknown>): string {
  const data = (raw.data ?? {}) as Record<string, any>;
  return String(data.bounce?.message ?? data.bounce?.subType ?? data.reason ?? '').slice(0, 300);
}

/** Which part of the project / lead page a notification opens at (the page scrolls to it). */
const SECTION: Partial<Record<TemplateName, string>> = {
  message_to_customer: 'messages', message_to_staff: 'messages', info_request: 'messages',
  quote_ready: 'quotes', quote_response_staff: 'quotes', quote_response_ack: 'quotes',
  document_ready: 'documents', approval_request: 'documents', approval_staff: 'approvals',
  sample_shipped: 'products', feedback_request: 'products', sample_feedback_staff: 'products',
  stage_update: 'stages', task_assigned: 'tasks', lead_assigned: 'messages',
};

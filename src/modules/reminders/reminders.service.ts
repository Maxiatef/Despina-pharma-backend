import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ReminderState } from '../../database/entities/index.js';
import { EmailService } from '../email/email.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';

/**
 * Reminders (plan §07/§08: "reminders for stale waiting states, configurable schedules with caps and stop rules"
 * and "a dashboard of items waiting on customers and items waiting on Despina").
 *
 * Waiting on the customer – a reminder e-mail to the customer:
 *   quote sent and not answered · sample shipped and not rated · lead waiting for the customer's information
 *   Stop rules: the item changes (answered, new version, closed), the customer wrote a message since,
 *   the project is not active, staff paused it, the customer turned reminders off, or the cap is reached.
 * Waiting on us – one daily list per staff member (project owner / lead assignee):
 *   customer message not answered · quote changes requested · sample feedback received ·
 *   promised date soon or passed · internal target date passed
 *
 * Settings (Admin → Lead rules → Reminders), app_settings:
 *   reminders.customer.enabled / .first_days / .repeat_days / .max
 *   reminders.staff.enabled / .reply_hours / .due_soon_days
 */
export const REMINDER_KEYS = [
  'reminders.customer.enabled', 'reminders.customer.first_days', 'reminders.customer.repeat_days', 'reminders.customer.max',
  'reminders.staff.enabled', 'reminders.staff.reply_hours', 'reminders.staff.due_soon_days',
] as const;

const DEFAULTS: Record<(typeof REMINDER_KEYS)[number], string> = {
  'reminders.customer.enabled': 'true',
  'reminders.customer.first_days': '3',
  'reminders.customer.repeat_days': '4',
  'reminders.customer.max': '2',
  'reminders.staff.enabled': 'true',
  'reminders.staff.reply_hours': '24',
  'reminders.staff.due_soon_days': '7',
};

const LIMITS: Record<string, [number, number]> = {
  'reminders.customer.first_days': [1, 60], 'reminders.customer.repeat_days': [1, 60], 'reminders.customer.max': [0, 10],
  'reminders.staff.reply_hours': [1, 240], 'reminders.staff.due_soon_days': [1, 90],
};

export function validateReminderSetting(key: string, value: string): string | null {
  if (key.endsWith('.enabled')) return value === 'true' || value === 'false' ? null : 'Use on or off';
  const [min, max] = LIMITS[key] ?? [0, 0];
  return /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max ? null : `Must be a whole number from ${min} to ${max}`;
}

const DAY = 86_400_000;

export interface CustomerItem {
  key: string;
  type: 'quote' | 'sample' | 'inquiry';
  itemId: string;
  title: string;
  ref: string;
  company: string | null;
  projectId: string | null;
  inquiryId: string | null;
  since: Date;
  recipients: string[];
  /** Extra e-mail fields (quote number, sample title …). */
  data: Record<string, unknown>;
}

export interface StaffItem {
  type: 'unanswered_message' | 'quote_changes' | 'sample_feedback' | 'promised_soon' | 'promised_passed' | 'target_passed';
  title: string;
  ref: string;
  company: string | null;
  projectId: string | null;
  inquiryId: string | null;
  since: Date | string;
  owner: string | null;
}

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer?: NodeJS.Timeout;
  private lastRunDay = '';

  constructor(
    private readonly ds: DataSource,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly access: ProjectAccessService,
  ) {}

  onModuleInit() {
    // Same hour as the overdue-task digest. On Vercel, /api/cron/run calls run() instead.
    if (!process.env.VERCEL) this.timer = setInterval(() => void this.tick(), 3_600_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getHours() !== Number(process.env.TASK_REMINDER_HOUR ?? 8) || this.lastRunDay === day) return;
    this.lastRunDay = day;
    try {
      await this.run();
    } catch (err) {
      this.logger.error((err as Error).message);
    }
  }

  async config() {
    const s = await this.settings.getMany(REMINDER_KEYS);
    const v = (k: (typeof REMINDER_KEYS)[number]) => s[k] ?? DEFAULTS[k];
    return {
      customer: { enabled: v('reminders.customer.enabled') !== 'false', firstDays: Number(v('reminders.customer.first_days')), repeatDays: Number(v('reminders.customer.repeat_days')), max: Number(v('reminders.customer.max')) },
      staff: { enabled: v('reminders.staff.enabled') !== 'false', replyHours: Number(v('reminders.staff.reply_hours')), dueSoonDays: Number(v('reminders.staff.due_soon_days')) },
      values: s,
      defaults: DEFAULTS,
    };
  }

  // =================================================================== what is waiting
  /** Items waiting on the customer, newest state only (a new quote version / sample revision is a new item). */
  async waitingOnCustomer(): Promise<CustomerItem[]> {
    const quotes: any[] = await this.ds.query(`
      SELECT q.id, q.quote_no, p.id AS project_id, p.code, p.name AS project_name, p.company_id, c.name AS company,
             v.id AS version_id, v.version_no, v.created_at AS since
      FROM quotes q
      JOIN projects p ON p.id = q.project_id AND p.status = 'active'
      JOIN companies c ON c.id = p.company_id
      JOIN LATERAL (SELECT id, version_no, created_at FROM quote_versions WHERE quote_id = q.id ORDER BY version_no DESC LIMIT 1) v ON true
      WHERE q.status = 'sent'`);
    const samples: any[] = await this.ds.query(`
      SELECT s.id, s.title, pp.name AS product_name, p.id AS project_id, p.code, p.name AS project_name, p.company_id, c.name AS company,
             r.id AS revision_id, r.revision_no, r.shipped_at AS since
      FROM samples s
      JOIN project_products pp ON pp.id = s.project_product_id
      JOIN projects p ON p.id = pp.project_id AND p.status = 'active'
      JOIN companies c ON c.id = p.company_id
      JOIN LATERAL (SELECT id, revision_no, shipped_at FROM sample_revisions WHERE sample_id = s.id ORDER BY revision_no DESC LIMIT 1) r ON true
      WHERE s.status = 'shipped' AND r.shipped_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.sample_revision_id = r.id)`);
    const leads: any[] = await this.ds.query(`
      SELECT i.id, i.reference_no, i.contact_id, ct.email, ct.first_name, ct.last_name, co.name AS company,
             COALESCE((SELECT max(e.created_at) FROM status_events e WHERE e.inquiry_id = i.id AND e.to_status = 'awaiting_customer'), i.updated_at) AS since,
             (SELECT m.body FROM messages m WHERE m.inquiry_id = i.id AND m.sender_id IS NOT NULL ORDER BY m.created_at DESC LIMIT 1) AS question
      FROM inquiries i
      JOIN contacts ct ON ct.id = i.contact_id
      LEFT JOIN companies co ON co.id = i.company_id
      WHERE i.status = 'awaiting_customer' AND i.held_at IS NULL`);

    // A customer message after the item started waiting counts as their answer: no reminder until staff act.
    const replied: { project_id: string | null; inquiry_id: string | null; last: Date }[] = await this.ds.query(`
      SELECT m.project_id, m.inquiry_id, max(m.created_at) AS last
      FROM messages m LEFT JOIN users u ON u.id = m.sender_id
      WHERE (u.role = 'customer' OR (m.sender_id IS NULL AND m.sender_contact_id IS NOT NULL))
      GROUP BY m.project_id, m.inquiry_id`);
    const lastReply = (projectId: string | null, inquiryId: string | null) =>
      replied.filter((r) => (projectId && r.project_id === projectId) || (inquiryId && r.inquiry_id === inquiryId))
        .reduce<Date | null>((a, r) => (!a || new Date(r.last) > a ? new Date(r.last) : a), null);

    const recipients = new Map<string, string[]>();
    const companyEmails = async (companyId: string) => {
      if (!recipients.has(companyId)) recipients.set(companyId, await this.access.customerEmails(companyId));
      return recipients.get(companyId)!;
    };

    const out: CustomerItem[] = [];
    for (const q of quotes) {
      out.push({
        key: `quote:${q.id}:${q.version_id}`, type: 'quote', itemId: q.id, title: `Quote ${q.quote_no}${q.version_no > 1 ? ` (version ${q.version_no})` : ''} – waiting for an answer`,
        ref: q.code, company: q.company, projectId: q.project_id, inquiryId: null, since: new Date(q.since),
        recipients: await companyEmails(q.company_id), data: { quoteNo: q.quote_no, projectCode: q.code, projectName: q.project_name },
      });
    }
    for (const s of samples) {
      out.push({
        key: `sample:${s.id}:${s.revision_id}`, type: 'sample', itemId: s.id, title: `${s.title} (revision ${s.revision_no}) – waiting for feedback`,
        ref: s.code, company: s.company, projectId: s.project_id, inquiryId: null, since: new Date(s.since),
        recipients: await companyEmails(s.company_id), data: { sampleTitle: s.title, revisionNo: s.revision_no, productName: s.product_name, projectCode: s.code, projectName: s.project_name },
      });
    }
    for (const l of leads) {
      out.push({
        key: `inquiry:${l.id}:${new Date(l.since).getTime()}`, type: 'inquiry', itemId: l.id, title: `${l.reference_no} – waiting for the customer's information`,
        ref: l.reference_no, company: l.company, projectId: null, inquiryId: l.id, since: new Date(l.since),
        recipients: [l.email], data: { referenceNo: l.reference_no, contactName: [l.first_name, l.last_name].filter(Boolean).join(' '), question: l.question },
      });
    }
    return out.filter((i) => {
      const r = lastReply(i.projectId, i.inquiryId);
      return !r || r < i.since;
    });
  }

  /** Items waiting on Despina, with the staff member who should act. */
  async waitingOnUs(): Promise<StaffItem[]> {
    const cfg = await this.config();
    const owner = `(SELECT u.email FROM users u WHERE u.id = p.owner_id AND u.is_active)`;
    const leadOwner = `(SELECT u.email FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.inquiry_id = i.id AND a.unassigned_at IS NULL AND u.is_active ORDER BY a.created_at DESC LIMIT 1)`;
    const [messages, quotes, samples, dates] = await Promise.all([
      this.ds.query(`
        WITH last AS (
          SELECT DISTINCT ON (coalesce(m.project_id, m.inquiry_id)) m.project_id, m.inquiry_id, m.created_at, m.sender_id, m.sender_contact_id, u.role
          FROM messages m LEFT JOIN users u ON u.id = m.sender_id
          ORDER BY coalesce(m.project_id, m.inquiry_id), m.created_at DESC
        )
        SELECT l.project_id, l.inquiry_id, l.created_at AS since,
               coalesce(p.code, i.reference_no) AS ref, coalesce(pc.name, ic.name) AS company,
               coalesce(${owner}, ${leadOwner}) AS owner
        FROM last l
        LEFT JOIN projects p ON p.id = l.project_id
        LEFT JOIN companies pc ON pc.id = p.company_id
        LEFT JOIN inquiries i ON i.id = l.inquiry_id
        LEFT JOIN companies ic ON ic.id = i.company_id
        WHERE (l.role = 'customer' OR (l.sender_id IS NULL AND l.sender_contact_id IS NOT NULL))
          AND l.created_at < now() - make_interval(hours => $1)
          AND (p.id IS NULL OR p.status = 'active')
          AND (i.id IS NULL OR (i.status NOT IN ('won', 'lost', 'closed', 'not_a_fit') AND i.held_at IS NULL))`, [cfg.staff.replyHours]),
      this.ds.query(`
        SELECT q.quote_no, q.updated_at AS since, p.id AS project_id, p.code AS ref, c.name AS company, ${owner} AS owner
        FROM quotes q JOIN projects p ON p.id = q.project_id AND p.status = 'active' JOIN companies c ON c.id = p.company_id
        WHERE q.status = 'changes_requested'`),
      this.ds.query(`
        SELECT s.title, s.updated_at AS since, p.id AS project_id, p.code AS ref, c.name AS company, ${owner} AS owner
        FROM samples s JOIN project_products pp ON pp.id = s.project_product_id
        JOIN projects p ON p.id = pp.project_id AND p.status = 'active' JOIN companies c ON c.id = p.company_id
        WHERE s.status = 'feedback_received'`),
      this.ds.query(`
        SELECT p.id AS project_id, p.code AS ref, c.name AS company, ${owner} AS owner, x.label,
               to_char(x.promised_date, 'YYYY-MM-DD') AS promised_date, to_char(x.target_date, 'YYYY-MM-DD') AS target_date
        FROM projects p JOIN companies c ON c.id = p.company_id
        JOIN LATERAL (
          SELECT NULL::text AS label, p.promised_date, p.target_date
          UNION ALL
          SELECT pp.name, pp.promised_date, pp.target_date FROM project_products pp WHERE pp.project_id = p.id
        ) x ON x.promised_date IS NOT NULL OR x.target_date IS NOT NULL
        WHERE p.status = 'active'`),
    ]);
    const out: StaffItem[] = [];
    for (const m of messages) {
      out.push({ type: 'unanswered_message', title: `Customer message not answered yet`, ref: m.ref, company: m.company, projectId: m.project_id, inquiryId: m.inquiry_id, since: new Date(m.since), owner: m.owner });
    }
    for (const q of quotes) out.push({ type: 'quote_changes', title: `Quote ${q.quote_no}: customer asked for changes`, ref: q.ref, company: q.company, projectId: q.project_id, inquiryId: null, since: new Date(q.since), owner: q.owner });
    for (const s of samples) out.push({ type: 'sample_feedback', title: `${s.title}: feedback received, next step needed`, ref: s.ref, company: s.company, projectId: s.project_id, inquiryId: null, since: new Date(s.since), owner: s.owner });
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + cfg.staff.dueSoonDays * DAY).toISOString().slice(0, 10);
    for (const d of dates) {
      const what = d.label ? `"${d.label}"` : 'Project';
      const promised: string | null = d.promised_date;
      const target: string | null = d.target_date;
      const base = { ref: d.ref, company: d.company, projectId: d.project_id, inquiryId: null, owner: d.owner };
      if (promised && promised < today) out.push({ ...base, type: 'promised_passed', title: `${what}: promised date ${promised} has passed`, since: promised });
      else if (promised && promised <= soon) out.push({ ...base, type: 'promised_soon', title: `${what}: promised to the customer for ${promised}`, since: promised });
      if (target && target < today) out.push({ ...base, type: 'target_passed', title: `${what}: internal target ${target} has passed`, since: target });
    }
    return out;
  }

  // =================================================================== state (counts, pause)
  /** Keeps one reminder_states row per waiting item; rows of items that stopped waiting are removed. */
  private async sync(items: CustomerItem[]) {
    const repo = this.ds.getRepository(ReminderState);
    const keys = items.map((i) => i.key);
    if (keys.length) {
      await this.ds.query(`DELETE FROM reminder_states WHERE NOT (item_key = ANY($1))`, [keys]);
      for (const i of items) {
        await this.ds.query(
          `INSERT INTO reminder_states (item_key, item_type, item_id, project_id, inquiry_id, waiting_since)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (item_key) DO NOTHING`,
          [i.key, i.type, i.itemId, i.projectId, i.inquiryId, i.since],
        );
      }
    } else {
      await this.ds.query(`DELETE FROM reminder_states`);
    }
    return new Map((await repo.find()).map((r) => [r.itemKey, r]));
  }

  private nextAt(state: ReminderState, cfg: Awaited<ReturnType<RemindersService['config']>>) {
    if (state.pausedAt || state.sentCount >= cfg.customer.max) return null;
    const from = state.lastSentAt ?? state.waitingSince;
    return new Date(new Date(from).getTime() + (state.sentCount === 0 ? cfg.customer.firstDays : cfg.customer.repeatDays) * DAY);
  }

  /** Addresses that turned reminder e-mails off. */
  private async optedOut(emails: string[]) {
    if (!emails.length) return new Set<string>();
    const rows: { email: string }[] = await this.ds.query(
      `SELECT lower(email) AS email FROM contacts WHERE reminders_off_at IS NOT NULL AND lower(email) = ANY($1)`, [emails.map((e) => e.toLowerCase())]);
    return new Set(rows.map((r) => r.email));
  }

  /** The waiting list for the staff page (also refreshes the reminder rows, without sending anything). */
  async overview() {
    const cfg = await this.config();
    const [customer, us] = await Promise.all([this.waitingOnCustomer(), this.waitingOnUs()]);
    const states = await this.sync(customer);
    const off = await this.optedOut(customer.flatMap((i) => i.recipients));
    return {
      settings: cfg,
      waitingOnCustomer: customer
        .map((i) => {
          const st = states.get(i.key)!;
          const to = i.recipients.filter((e) => !off.has(e.toLowerCase()));
          return {
            key: i.key, type: i.type, title: i.title, ref: i.ref, company: i.company, projectId: i.projectId, inquiryId: i.inquiryId,
            since: i.since, sentCount: st?.sentCount ?? 0, lastSentAt: st?.lastSentAt ?? null, pausedAt: st?.pausedAt ?? null,
            nextAt: st && cfg.customer.enabled && to.length ? this.nextAt(st, cfg) : null,
            recipients: i.recipients.length, optedOut: i.recipients.length - to.length,
          };
        })
        .sort((a, b) => +new Date(a.since) - +new Date(b.since)),
      waitingOnUs: us.sort((a, b) => String(a.since).localeCompare(String(b.since))),
    };
  }

  async pause(key: string, paused: boolean, actorId: string) {
    const repo = this.ds.getRepository(ReminderState);
    const row = await repo.findOneBy({ itemKey: key });
    if (!row) throw new NotFoundException('This item is not waiting any more');
    await repo.update(row.id, { pausedAt: paused ? new Date() : null, pausedBy: paused ? actorId : null });
    return this.overview();
  }

  /** Staff "Send reminder now" (counts towards the cap). */
  async sendNow(key: string) {
    const cfg = await this.config();
    const items = await this.waitingOnCustomer();
    const item = items.find((i) => i.key === key);
    if (!item) throw new NotFoundException('This item is not waiting any more');
    const states = await this.sync(items);
    const st = states.get(key)!;
    if (st.sentCount >= cfg.customer.max) throw new BadRequestException(`The limit of ${cfg.customer.max} reminders for this item is reached`);
    const sent = await this.remind(item, st);
    if (!sent) throw new BadRequestException('No one to remind: the customer has no active login or turned reminder e-mails off');
    return this.overview();
  }

  private async remind(item: CustomerItem, st: ReminderState) {
    const off = await this.optedOut(item.recipients);
    const to = item.recipients.filter((e) => !off.has(e.toLowerCase()));
    for (const address of to) {
      await this.email.toCustomer('reminder', address, 'customer_reminder', {
        ...item.data, kind: item.type, projectId: item.projectId, inquiryId: item.inquiryId, number: st.sentCount + 1,
        since: item.since, stopUrl: this.stopUrl(address),
      }, { projectId: item.projectId, inquiryId: item.inquiryId });
    }
    if (to.length) await this.ds.getRepository(ReminderState).update(st.id, { sentCount: st.sentCount + 1, lastSentAt: new Date() });
    return to.length;
  }

  // =================================================================== daily job
  /** Customer reminders that are due + one "waiting on you" list per staff member. */
  async run(now = new Date()) {
    const cfg = await this.config();
    const items = await this.waitingOnCustomer();
    const states = await this.sync(items);
    let customerReminders = 0;
    if (cfg.customer.enabled && cfg.customer.max > 0) {
      for (const item of items) {
        const st = states.get(item.key);
        const next = st && this.nextAt(st, cfg);
        if (st && next && next <= now) customerReminders += await this.remind(item, st);
      }
    }

    let staffDigests = 0;
    if (cfg.staff.enabled) {
      const byOwner = new Map<string, StaffItem[]>();
      for (const i of await this.waitingOnUs()) {
        const to = (i.owner || this.email.ownerEmail || '').toLowerCase();
        if (!to) continue;
        byOwner.set(to, [...(byOwner.get(to) ?? []), i]);
      }
      for (const [to, list] of byOwner) {
        const jobs = await this.email.notifyStaff('waiting.digest', 'waiting_digest', {
          items: list.map((i) => `${i.ref}${i.company ? ` · ${i.company}` : ''} – ${i.title}`),
        }, { people: [to] });
        staffDigests += jobs.length;
      }
    }
    this.logger.log(`reminders: ${customerReminders} customer reminder(s), ${staffDigests} staff list(s)`);
    return { customerReminders, staffDigests };
  }

  // =================================================================== "stop reminders" link
  private sign(email: string) {
    const secret = process.env.APP_SECRET ?? '';
    if (secret.length < 32) throw new Error('APP_SECRET must be set (32+ characters)');
    return createHmac('sha256', secret).update(`reminders-off.${email.toLowerCase()}`).digest('base64url');
  }

  stopUrl(email: string) {
    return `${this.email.appUrl}/api/reminders/stop?e=${encodeURIComponent(email.toLowerCase())}&t=${this.sign(email)}`;
  }

  checkStopToken(email: string, token: string) {
    const a = Buffer.from(this.sign(email));
    const b = Buffer.from(token ?? '');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** The customer clicked "stop reminders": only reminder e-mails stop, normal project e-mails continue. */
  async turnOff(email: string) {
    await this.ds.query(`UPDATE contacts SET reminders_off_at = now() WHERE lower(email) = lower($1) AND reminders_off_at IS NULL`, [email]);
    await this.audit.log({ actorId: null, action: 'reminder.opt_out', entityType: 'contact', entityId: null, after: { email: email.toLowerCase() } });
  }

  /** Staff turn reminder e-mails back on for a contact (when the customer asks). */
  async turnOn(contactId: string) {
    await this.ds.query(`UPDATE contacts SET reminders_off_at = NULL WHERE id = $1`, [contactId]);
    return { ok: true };
  }
}

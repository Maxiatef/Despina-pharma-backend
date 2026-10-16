import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import {
  Assignment, CatalogCategory, CatalogItem, Company, ConsentRecord, Contact, Document, DocumentVersion,
  EmailJob, Inquiry, InquiryItem, Message, Service, StatusEvent, Task, User,
} from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../email/email.service.js';
import { STAFF_ROLES } from '../../common/enums.js';
import type { FormType, InquiryStatus, InquiryType } from '../../common/enums.js';
import { csvCell, paged } from '../../common/utils.js';
import { addBusinessHours } from '../../common/business-hours.js';
import { SettingsService } from '../settings/settings.service.js';
import { leadRule, loadBusinessConfig } from '../settings/work-rules.js';
import type { StaffNotificationKey } from '../email/email-settings.js';
import { verifyUploadToken } from '../documents/upload-token.js';
import { maxFiles } from '../documents/documents.service.js';
import { StorageService } from '../documents/storage/storage.service.js';
import { currentRequestId } from '../../common/request-context.js';
import { spamReasons } from './spam-check.js';
import { InquiryQueryDto, SubmitInquiryDto } from './dto/inquiry.dto.js';

const FORM_LABELS: Record<FormType, string> = {
  contact: 'Contact', new_customer: 'Company profile', new_product: 'Product brief', sample_request: 'Sample request',
  sample_feedback: 'Sample feedback', service: 'Service inquiry',
};
export const INQUIRY_TYPE_LABELS: Record<InquiryType, string> = {
  general: 'General question', new_product: 'New product development', private_label: 'Private label / stock formula',
  sample_request: 'Sample request', quotation: 'Quotation / pricing', packaging_filling: 'Packaging & filling',
  existing_project: 'Existing project', partnership: 'Partnership / supplier', other: 'Other',
};

/** Which staff notification (Admin → Settings → Emails) each form uses. */
const NOTIFY_KEY: Record<FormType, StaffNotificationKey> = {
  contact: 'inquiry.contact', new_product: 'inquiry.new_product', service: 'inquiry.new_product', new_customer: 'inquiry.new_customer',
  sample_request: 'inquiry.sample_request', sample_feedback: 'inquiry.sample_feedback',
};

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class InquiriesService {
  constructor(
    private readonly ds: DataSource,
    @InjectRepository(Inquiry) private readonly inquiries: Repository<Inquiry>,
    @InjectRepository(StatusEvent) private readonly statusEvents: Repository<StatusEvent>,
    @InjectRepository(Assignment) private readonly assignments: Repository<Assignment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  // =====================================================================
  // Public submission
  // =====================================================================
  async submit(dto: SubmitInquiryDto, meta: RequestMeta) {
    // Honeypot: bots fill hidden fields. Pretend success, store nothing.
    if (dto.hp) return { referenceNo: 'DP-INQ-0000-000000', status: 'new' as InquiryStatus, duplicate: false };

    if ((dto.uploads?.length ?? 0) > maxFiles()) throw new BadRequestException(`At most ${maxFiles()} files per request`);

    const existing = await this.inquiries.findOneBy({ idempotencyKey: dto.idempotencyKey });
    if (existing) return { id: existing.id, referenceNo: existing.referenceNo, status: existing.status, duplicate: true };

    const held = this.spamCheck(dto);
    try {
      return await this.ds.transaction(async (m) => {
        const company = dto.company ? await this.upsertCompany(m, dto.company) : null;
        const contact = await this.upsertContact(m, dto.contact, company?.id ?? null, held.length > 0);

        const [{ seq }] = await m.query(`SELECT nextval('inquiry_reference_seq')::int AS seq`);
        const referenceNo = `DP-INQ-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

        const inquiry = await m.getRepository(Inquiry).save(
          m.getRepository(Inquiry).create({
            referenceNo,
            formType: dto.formType,
            inquiryType: dto.inquiryType ?? null,
            status: 'new',
            contactId: contact.id,
            companyId: company?.id ?? null,
            message: dto.message ?? null,
            payload: dto.payload ?? {},
            sourcePage: dto.sourcePage ?? null,
            idempotencyKey: dto.idempotencyKey,
            ip: meta.ip,
            userAgent: meta.userAgent,
            heldAt: held.length ? new Date() : null,
            holdReasons: held.length ? held : null,
            requestId: currentRequestId(),
          }),
        );

        const items = await this.saveItems(m, inquiry.id, dto);
        await this.attachUploads(m, inquiry.id, company?.id ?? null, dto.uploads ?? []);

        const consents = m.getRepository(ConsentRecord);
        await consents.insert({
          contactId: contact.id, inquiryId: inquiry.id, consentType: 'privacy', granted: true,
          policyVersion: dto.consent.policyVersion ?? null, ip: meta.ip,
        });
        if (dto.consent.marketing !== undefined) {
          await consents.insert({
            contactId: contact.id, inquiryId: inquiry.id, consentType: 'marketing', granted: dto.consent.marketing,
            policyVersion: dto.consent.policyVersion ?? null, ip: meta.ip,
          });
        }

        await m.getRepository(StatusEvent).insert({ inquiryId: inquiry.id, fromStatus: null, toStatus: 'new', note: 'Submitted from website' });
        if (held.length) {
          await m.getRepository(StatusEvent).insert({ inquiryId: inquiry.id, note: `Held for review (possible spam): ${held.join('; ')}` });
          // The same answer as a normal form, so a bot learns nothing; nothing is e-mailed.
          return { id: inquiry.id, referenceNo, status: inquiry.status, duplicate: false, confirmationEmail: false };
        }

        const ack = await this.dispatch(m, inquiry, contact, company, {
          formType: dto.formType, inquiryType: dto.inquiryType, payload: dto.payload, message: dto.message, sourcePage: dto.sourcePage,
          itemLabels: items.map((i) => i.label), attachments: dto.uploads?.length ?? 0,
        });
        // Tells the website whether a confirmation e-mail is really on its way.
        const confirmationEmail = !!ack && ack.status === 'queued' && (await this.email.customerEmailOn('inquiry_ack'));
        return { id: inquiry.id, referenceNo, status: inquiry.status, duplicate: false, confirmationEmail };
      });
    } catch (err) {
      // Two identical requests at the same moment: the unique idempotency key wins; return the stored one.
      if ((err as any)?.code === '23505') {
        const again = await this.inquiries.findOneBy({ idempotencyKey: dto.idempotencyKey });
        if (again) return { id: again.id, referenceNo: again.referenceNo, status: again.status, duplicate: true };
      }
      throw err;
    }
  }

  /** Reasons to hold this form for review (empty = looks fine). See spam-check.ts. */
  private spamCheck(dto: SubmitInquiryDto) {
    const fields = (dto.payload?.fields ?? {}) as Record<string, unknown>;
    const fieldTexts = Object.entries(fields)
      .filter(([k]) => !/website|link|benchmark|reference|url/i.test(k))
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
      .filter((v): v is string => typeof v === 'string');
    return spamReasons({
      name: [dto.contact.firstName, dto.contact.lastName].filter(Boolean).join(' '), email: dto.contact.email, company: dto.company?.name,
      message: dto.message, fieldTexts, elapsedMs: dto.elapsedMs,
    });
  }

  /**
   * The team notice, the visitor's confirmation and the follow-up task. Runs when a form arrives,
   * or later when staff release a form the spam check held.
   */
  private async dispatch(m: EntityManager, inquiry: Inquiry, contact: Contact, company: Company | null, src: {
    formType: FormType; inquiryType?: InquiryType | null; payload?: Record<string, unknown>; message?: string | null;
    sourcePage?: string | null; itemLabels: string[]; attachments: number;
  }) {
    const referenceNo = inquiry.referenceNo;
    const followUp = await this.createFollowUp(m, inquiry, src.formType, src.inquiryType ?? undefined);

    // Two separate e-mails: a notice to the team (recipients per form type in Settings → Emails) and a
    // confirmation to the visitor. Both are switchable in Settings; they are sent right after this request.
    const labels = (src.payload?.labels ?? {}) as Record<string, string>;
    const fields = (src.payload?.fields ?? {}) as Record<string, string | string[]>;
    const one = (k: string) => { const v = fields[k]; return (Array.isArray(v) ? v.join(', ') : v)?.toString().trim() || undefined; };
    // Shown as their own rows in the team e-mail, so they are left out of the answer list.
    const headline = ['productName', 'format', 'category', 'service', 'quantity', 'fillSize', 'timing', 'fillBudget', 'attachment', 'attachments'];
    const answers = Object.entries(fields)
      .filter(([k]) => !['name', 'email', 'company', 'message', 'phone', ...headline].includes(k))
      .slice(0, 20)
      .map(([k, v]) => [labels[k] ?? k, (Array.isArray(v) ? v.join(', ') : String(v)).slice(0, 300)]);
    const data = {
      inquiryId: inquiry.id,
      referenceNo,
      formType: src.formType,
      inquiryType: src.inquiryType ? INQUIRY_TYPE_LABELS[src.inquiryType] : undefined,
      followUpDue: followUp.dueAt?.toISOString(),
      contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
      contactEmail: contact.email,
      companyName: company?.name,
      sourcePage: src.sourcePage ?? undefined,
      message: src.message ?? undefined,
      phone: contact.phone,
      items: src.itemLabels.length ? src.itemLabels
        : [[one('productName') ?? one('format'), one('category')].filter(Boolean).join(' – '), one('service')].filter(Boolean),
      quantity: [one('quantity'), one('fillSize')].filter(Boolean).join(' · ') || undefined,
      timing: one('timing'),
      budget: one('fillBudget'),
      attachments: src.attachments || undefined,
      answers,
      assignedTo: followUp.assigneeEmail,
      receivedAt: inquiry.createdAt,
    };
    await this.email.notifyStaff(NOTIFY_KEY[src.formType], 'owner_notice', data, { inquiryId: inquiry.id, manager: m });
    return this.email.toCustomer('inquiry_ack', contact.email, 'customer_ack', data, { inquiryId: inquiry.id, manager: m });
  }

  /** Staff checked a held form and it is real: send the e-mails and make the follow-up task now. */
  async release(id: string, actorId: string) {
    const inquiry = await this.inquiries.findOneBy({ id });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    if (!inquiry.heldAt) throw new BadRequestException('This form is not held for review');
    await this.ds.transaction(async (m) => {
      const contact = await m.getRepository(Contact).findOneByOrFail({ id: inquiry.contactId });
      const company = inquiry.companyId ? await m.getRepository(Company).findOneBy({ id: inquiry.companyId }) : null;
      const rows: { label: string }[] = await m.query(
        `SELECT concat_ws(' – ', ci.name, s.title, ii.notes, CASE WHEN ii.quantity IS NOT NULL THEN to_char(ii.quantity, 'FM999,999,999') || ' units' END) AS label
         FROM inquiry_items ii LEFT JOIN catalog_items ci ON ci.id = ii.catalog_item_id LEFT JOIN services s ON s.id = ii.service_id
         WHERE ii.inquiry_id = $1 ORDER BY ii.created_at`, [id]);
      const attachments = await m.getRepository(Document).countBy({ inquiryId: id });
      await m.getRepository(Inquiry).update(id, { heldAt: null });
      await m.getRepository(StatusEvent).insert({ inquiryId: id, actorId, note: 'Not spam: released from review – e-mails sent and follow-up task created' });
      await this.dispatch(m, inquiry, contact, company, {
        formType: inquiry.formType, inquiryType: inquiry.inquiryType as InquiryType | null, payload: inquiry.payload, message: inquiry.message,
        sourcePage: inquiry.sourcePage, itemLabels: rows.map((r) => r.label), attachments,
      });
      await this.audit.log({ actorId, action: 'inquiry.release', entityType: 'inquiry', entityId: id, before: { holdReasons: inquiry.holdReasons } }, m);
    });
    return this.inquiries.findOneByOrFail({ id });
  }

  /**
   * Staff confirmed a held form is spam: delete it with its files, and the contact / company it created
   * when nothing else uses them.
   */
  async deleteSpam(id: string, actorId: string) {
    const inquiry = await this.inquiries.findOneBy({ id });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    if (!inquiry.heldAt) throw new BadRequestException('Only forms held for review can be deleted as spam');
    const files: { storage_key: string }[] = await this.ds.query(
      `SELECT dv.storage_key FROM document_versions dv JOIN documents d ON d.id = dv.document_id WHERE d.inquiry_id = $1`, [id]);
    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM documents WHERE inquiry_id = $1`, [id]);
      await m.getRepository(Inquiry).delete(id);
      await m.query(
        `DELETE FROM contacts c WHERE c.id = $1 AND NOT EXISTS (SELECT 1 FROM inquiries i WHERE i.contact_id = c.id)
           AND NOT EXISTS (SELECT 1 FROM users u WHERE u.contact_id = c.id)`, [inquiry.contactId]);
      if (inquiry.companyId) {
        await m.query(
          `DELETE FROM companies co WHERE co.id = $1 AND NOT EXISTS (SELECT 1 FROM inquiries i WHERE i.company_id = co.id)
             AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.company_id = co.id) AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.company_id = co.id)
             AND NOT EXISTS (SELECT 1 FROM company_memberships cm WHERE cm.company_id = co.id)`, [inquiry.companyId]);
      }
      await this.audit.log({ actorId, action: 'inquiry.delete_spam', entityType: 'inquiry', entityId: id,
        before: { referenceNo: inquiry.referenceNo, holdReasons: inquiry.holdReasons } }, m);
    });
    for (const f of files) await this.storage.remove(f.storage_key);
    return { ok: true };
  }

  /** Held forms are not worked on until staff release them. */
  private notHeld(inquiry: Inquiry) {
    if (inquiry.heldAt) throw new BadRequestException('This form is held as possible spam – release it first');
  }

  /**
   * Every new inquiry gets a follow-up task in the dashboard, due after the response target (Admin → Settings → Rules, .env fallback).
   * Assignment rule per form type (Settings → Rules, or AUTO_ASSIGN_<FORM_TYPE> / AUTO_ASSIGN_DEFAULT) → the lead and the task go to that person.
   */
  private async createFollowUp(m: EntityManager, inquiry: Inquiry, formType: FormType, inquiryType?: InquiryType) {
    const { assigneeEmail, priority } = await leadRule(this.settings, formType);
    const found = assigneeEmail
      ? await m.getRepository(User).createQueryBuilder('u').where('lower(u.email) = lower(:e) AND u.isActive', { e: assigneeEmail }).getOne()
      : null;
    const assignee = found && STAFF_ROLES.includes(found.role) ? found : null;
    if (assignee) {
      await m.getRepository(Assignment).insert({ inquiryId: inquiry.id, userId: assignee.id, assignedBy: null });
      await m.getRepository(Inquiry).update(inquiry.id, { status: 'assigned' });
      await m.getRepository(StatusEvent).insert({ inquiryId: inquiry.id, fromStatus: 'new', toStatus: 'assigned', note: `Automatically assigned to ${assignee.email}` });
    }
    const topic = [FORM_LABELS[formType], inquiryType && INQUIRY_TYPE_LABELS[inquiryType]].filter(Boolean).join(' – ');
    const cfg = await loadBusinessConfig(this.settings);
    const task = await m.getRepository(Task).save(
      m.getRepository(Task).create({
        inquiryId: inquiry.id,
        assigneeId: assignee?.id ?? null,
        title: `Follow up ${inquiry.referenceNo} (${topic})`.slice(0, 300),
        priority,
        dueAt: addBusinessHours(new Date(), cfg.followUpHours, cfg),
      }),
    );
    return Object.assign(task, { assigneeEmail: assignee?.email ?? null });
  }

  private async upsertCompany(m: EntityManager, input: NonNullable<SubmitInquiryDto['company']>) {
    const repo = m.getRepository(Company);
    const found = await repo.createQueryBuilder('c').where('lower(c.name) = lower(:name)', { name: input.name.trim() }).getOne();
    if (found) {
      // Fill gaps only; never overwrite staff-curated data from a public form.
      const patch: { website?: string; country?: string; industry?: string } = {};
      if (!found.website && input.website) patch.website = input.website;
      if (!found.country && input.country) patch.country = input.country;
      if (!found.industry && input.industry) patch.industry = input.industry;
      if (Object.keys(patch).length) await repo.update(found.id, patch);
      return found;
    }
    return repo.save(repo.create({ ...input, name: input.name.trim() }));
  }

  private async upsertContact(m: EntityManager, input: SubmitInquiryDto['contact'], companyId: string | null, held = false) {
    const repo = m.getRepository(Contact);
    const qb = repo.createQueryBuilder('c').where('lower(c.email) = lower(:email)', { email: input.email });
    if (companyId) qb.andWhere('(c.company_id = :companyId OR c.company_id IS NULL)', { companyId });
    const found = await qb.orderBy('c.updatedAt', 'DESC').getOne();
    // A held (possible spam) form must not change a real contact's details.
    if (found && held) return found;
    if (found) {
      await repo.update(found.id, {
        firstName: input.firstName,
        lastName: input.lastName ?? found.lastName,
        phone: input.phone ?? found.phone,
        jobTitle: input.jobTitle ?? found.jobTitle,
        country: input.country ?? found.country,
        companyId: found.companyId ?? companyId,
      });
      return repo.findOneByOrFail({ id: found.id });
    }
    return repo.save(repo.create({ ...input, email: input.email.trim(), companyId }));
  }

  private async saveItems(m: EntityManager, inquiryId: string, dto: SubmitInquiryDto) {
    const saved: { label: string }[] = [];
    for (const it of dto.items ?? []) {
      let catalogItem: CatalogItem | null = null;
      let service: Service | null = null;
      if (it.catalogItemId) catalogItem = await m.getRepository(CatalogItem).findOneBy({ id: it.catalogItemId });
      else if (it.catalogPath) {
        const [catSlug, itemSlug] = it.catalogPath.replace(/^\/?(formulations\/)?/, '').replace(/\/$/, '').split('/');
        const cat = await m.getRepository(CatalogCategory).findOneBy({ slug: catSlug });
        if (cat && itemSlug) catalogItem = await m.getRepository(CatalogItem).findOneBy({ categoryId: cat.id, slug: itemSlug });
      }
      if (it.serviceId) service = await m.getRepository(Service).findOneBy({ id: it.serviceId });
      else if (it.serviceSlug) service = await m.getRepository(Service).findOneBy({ slug: it.serviceSlug });

      if ((it.catalogItemId || it.catalogPath) && !catalogItem) throw new BadRequestException('Unknown catalog item');
      if ((it.serviceId || it.serviceSlug) && !service) throw new BadRequestException('Unknown service');

      await m.getRepository(InquiryItem).insert({
        inquiryId,
        catalogItemId: catalogItem?.id ?? null,
        serviceId: service?.id ?? null,
        quantity: it.quantity ?? null,
        notes: it.notes ?? null,
      });
      const qty = it.quantity ? `${it.quantity.toLocaleString('en-US')} units` : null;
      saved.push({ label: [catalogItem?.name, service?.title, it.notes, qty].filter(Boolean).join(' – ') });
    }
    return saved;
  }

  private async attachUploads(m: EntityManager, inquiryId: string, companyId: string | null, uploads: { documentId: string; token: string }[]) {
    for (const u of uploads) {
      if (!verifyUploadToken(u.documentId, u.token)) throw new BadRequestException('Invalid upload reference');
      const doc = await m.getRepository(Document).findOneBy({ id: u.documentId, inquiryId: IsNull(), projectId: IsNull() });
      if (!doc) throw new BadRequestException('Upload not found or already attached');
      const version = await m.getRepository(DocumentVersion).findOneBy({ documentId: doc.id });
      if (!version) throw new BadRequestException('Upload was not completed');
      await m.getRepository(Document).update(doc.id, { inquiryId, companyId });
    }
  }

  // =====================================================================
  // Staff dashboard
  // =====================================================================
  private baseQuery(q: InquiryQueryDto) {
    const qb = this.inquiries
      .createQueryBuilder('i')
      .innerJoin(Contact, 'ct', 'ct.id = i.contactId')
      .leftJoin(Company, 'co', 'co.id = i.companyId')
      .leftJoin(Assignment, 'a', 'a.inquiryId = i.id AND a.unassignedAt IS NULL')
      .leftJoin(User, 'au', 'au.id = a.userId')
      .addSelect(['ct.firstName', 'ct.lastName', 'ct.email', 'co.name', 'au.id', 'au.email'])
      .addSelect(
        `(SELECT min(t.due_at) FROM tasks t WHERE t.inquiry_id = i.id AND t.completed_at IS NULL)`,
        'next_due_at',
      );

    const statuses = q.status ? (Array.isArray(q.status) ? q.status : [q.status]) : [];
    if (statuses.length) qb.andWhere('i.status IN (:...statuses)', { statuses });
    // Forms held by the spam check only show in their own list.
    qb.andWhere(q.held === 'true' ? 'i.heldAt IS NOT NULL' : 'i.heldAt IS NULL');
    if (q.formType) qb.andWhere('i.formType = :formType', { formType: q.formType });
    if (q.inquiryType) qb.andWhere('i.inquiryType = :inquiryType', { inquiryType: q.inquiryType });
    if (q.companyId) qb.andWhere('i.companyId = :companyId', { companyId: q.companyId });
    if (q.assigneeId) qb.andWhere('a.userId = :assigneeId', { assigneeId: q.assigneeId });
    if (q.unassigned === 'true') qb.andWhere('a.id IS NULL');
    if (q.overdue === 'true') {
      qb.andWhere(`EXISTS (SELECT 1 FROM tasks t WHERE t.inquiry_id = i.id AND t.completed_at IS NULL AND t.due_at < now())`);
    }
    if (q.from) qb.andWhere('i.createdAt >= :from', { from: q.from });
    if (q.to) qb.andWhere('i.createdAt <= :to', { to: q.to });
    if (q.q) {
      qb.andWhere(
        `(i.reference_no ILIKE :q OR ct.email ILIKE :q OR ct.first_name || ' ' || coalesce(ct.last_name, '') ILIKE :q
          OR co.name ILIKE :q OR i.message ILIKE :q)`,
        { q: `%${q.q}%` },
      );
    }
    if (q.sort === 'oldest') qb.orderBy('i.createdAt', 'ASC');
    else if (q.sort === 'updated') qb.orderBy('i.updatedAt', 'DESC');
    else qb.orderBy('i.createdAt', 'DESC');
    return qb;
  }

  private shape(entities: Inquiry[], raw: any[]) {
    return entities.map((e) => {
      const r = raw.find((x) => x.i_id === e.id) ?? {};
      return {
        ...e,
        ip: undefined,
        userAgent: undefined,
        contact: { firstName: r.ct_first_name, lastName: r.ct_last_name, email: r.ct_email },
        companyName: r.co_name ?? null,
        assignee: r.au_id ? { id: r.au_id, email: r.au_email } : null,
        nextDueAt: r.next_due_at ?? null,
      };
    });
  }

  async list(q: InquiryQueryDto) {
    const qb = this.baseQuery(q).skip((q.page - 1) * q.pageSize).take(q.pageSize);
    const [{ entities, raw }, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);
    return paged(this.shape(entities, raw), total, q);
  }

  /** Board view: one column per status. */
  async board(q: InquiryQueryDto, perColumn = 50) {
    const columns: Record<string, unknown> = {};
    for (const status of ['new', 'assigned', 'awaiting_customer', 'qualified', 'quoted', 'won', 'lost', 'closed', 'not_a_fit'] as InquiryStatus[]) {
      const qb = this.baseQuery({ ...q, status } as InquiryQueryDto).take(perColumn);
      const [{ entities, raw }, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);
      columns[status] = { total, items: this.shape(entities, raw) };
    }
    return columns;
  }

  async summary() {
    const [row] = await this.ds.query(`
      SELECT
        (SELECT count(*)::int FROM inquiries h WHERE h.held_at IS NOT NULL) AS held,
        count(*) FILTER (WHERE i.status = 'new')::int AS new,
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.inquiry_id = i.id AND a.unassigned_at IS NULL)
                           AND i.status NOT IN ('won','lost','closed','not_a_fit'))::int AS unassigned,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.inquiry_id = i.id AND t.completed_at IS NULL AND t.due_at < now()))::int AS overdue,
        count(*) FILTER (WHERE i.status = 'awaiting_customer')::int AS awaiting_customer,
        count(*) FILTER (WHERE i.status = 'qualified')::int AS qualified,
        count(*) FILTER (WHERE i.status = 'quoted')::int AS quoted,
        count(*) FILTER (WHERE i.status = 'not_a_fit')::int AS not_a_fit,
        count(*) FILTER (WHERE i.status = 'won')::int AS won,
        count(*) FILTER (WHERE i.status = 'lost')::int AS lost,
        count(*)::int AS total
      FROM inquiries i WHERE i.held_at IS NULL`);
    return row;
  }

  async exportCsv(q: InquiryQueryDto) {
    const qb = this.baseQuery(q).take(10_000);
    const { entities, raw } = await qb.getRawAndEntities();
    const rows = this.shape(entities, raw);
    const header = ['reference_no', 'created_at', 'form_type', 'inquiry_type', 'status', 'first_name', 'last_name', 'email', 'company', 'assignee', 'source_page', 'message'];
    const lines = rows.map((r) =>
      [r.referenceNo, r.createdAt, r.formType, r.inquiryType, r.status, r.contact.firstName, r.contact.lastName, r.contact.email,
        r.companyName, r.assignee?.email, r.sourcePage, r.message].map(csvCell).join(','),
    );
    return [header.join(','), ...lines].join('\r\n');
  }

  async get(id: string) {
    const inquiry = await this.inquiries.findOneBy({ id });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    const m = this.ds.manager;
    const [contact, company, items, assignments, tasks, events, messages, documents, emails, consents] = await Promise.all([
      m.getRepository(Contact).findOneBy({ id: inquiry.contactId }),
      inquiry.companyId ? m.getRepository(Company).findOneBy({ id: inquiry.companyId }) : null,
      m.query(
        `SELECT ii.*, ci.name AS catalog_item_name, ci.slug AS catalog_item_slug, cc.slug AS category_slug, s.title AS service_title
         FROM inquiry_items ii
         LEFT JOIN catalog_items ci ON ci.id = ii.catalog_item_id
         LEFT JOIN catalog_categories cc ON cc.id = ci.category_id
         LEFT JOIN services s ON s.id = ii.service_id
         WHERE ii.inquiry_id = $1 ORDER BY ii.created_at`,
        [id],
      ),
      m.getRepository(Assignment).find({ where: { inquiryId: id }, order: { createdAt: 'DESC' } }),
      m.getRepository(Task).find({ where: { inquiryId: id }, order: { dueAt: 'ASC' } }),
      m.getRepository(StatusEvent).find({ where: { inquiryId: id }, order: { createdAt: 'ASC' } }),
      m.getRepository(Message).find({ where: { inquiryId: id }, order: { createdAt: 'ASC' } }),
      m.getRepository(Document).find({ where: { inquiryId: id }, order: { createdAt: 'ASC' } }),
      m.getRepository(EmailJob).find({ where: { inquiryId: id }, order: { createdAt: 'ASC' } }),
      m.getRepository(ConsentRecord).find({ where: { inquiryId: id } }),
    ]);
    const project = await this.ds.query(`SELECT id, code, name FROM projects WHERE source_inquiry_id = $1`, [id]);

    // Activity timeline: everything that happened, oldest first.
    const timeline = [
      ...events.map((e) => ({ type: 'status', at: e.createdAt, actorId: e.actorId, from: e.fromStatus, to: e.toStatus, note: e.note })),
      ...messages.map((x) => ({ type: 'message', at: x.createdAt, actorId: x.senderId, body: x.body, viaEmail: x.viaEmail })),
      ...emails.map((x) => ({ type: 'email', at: x.createdAt, kind: x.kind, to: x.toEmail, status: x.status, error: x.lastError })),
      ...documents.map((x) => ({ type: 'document', at: x.createdAt, documentId: x.id, title: x.title })),
      ...assignments.map((x) => ({ type: 'assignment', at: x.createdAt, userId: x.userId, by: x.assignedBy, endedAt: x.unassignedAt })),
      ...tasks.map((x) => ({ type: 'task', at: x.createdAt, taskId: x.id, title: x.title, dueAt: x.dueAt, completedAt: x.completedAt })),
    ].sort((a, b) => +new Date(a.at) - +new Date(b.at));

    return { ...inquiry, contact, company, items, assignments, tasks, documents, emails, consents, project: project[0] ?? null, timeline };
  }

  async changeStatus(id: string, status: InquiryStatus, note: string | undefined, actorId: string) {
    const inquiry = await this.inquiries.findOneBy({ id });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    this.notHeld(inquiry);
    if (inquiry.status === status && !note) return inquiry;
    await this.ds.transaction(async (m) => {
      await m.getRepository(Inquiry).update(id, { status });
      await m.getRepository(StatusEvent).insert({ inquiryId: id, actorId, fromStatus: inquiry.status, toStatus: status, note: note ?? null });
      await this.audit.log({ actorId, action: 'inquiry.status', entityType: 'inquiry', entityId: id, before: { status: inquiry.status }, after: { status } }, m);
    });
    return this.inquiries.findOneByOrFail({ id });
  }

  async addNote(id: string, note: string, actorId: string) {
    const inquiry = await this.inquiries.findOneBy({ id });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    return this.statusEvents.save(this.statusEvents.create({ inquiryId: id, actorId, fromStatus: null, toStatus: null, note }));
  }

  async assign(id: string, userId: string, actorId: string) {
    const inquiry = await this.inquiries.findOneBy({ id });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    this.notHeld(inquiry);
    const user = await this.users.findOneBy({ id: userId, isActive: true });
    if (!user || !STAFF_ROLES.includes(user.role)) throw new ForbiddenException('Leads can only be assigned to active staff');

    await this.ds.transaction(async (m) => {
      await m.getRepository(Assignment).update({ inquiryId: id, unassignedAt: IsNull() }, { unassignedAt: new Date() });
      await m.getRepository(Assignment).insert({ inquiryId: id, userId, assignedBy: actorId });
      // The lead's open tasks that nobody owns go to the same person (tasks someone already owns keep their owner).
      const taken = await m.getRepository(Task).createQueryBuilder().update()
        .set({ assigneeId: userId }).where('inquiry_id = :id AND assignee_id IS NULL AND completed_at IS NULL', { id }).returning(['id', 'title']).execute();
      if (taken.raw.length) {
        await this.audit.log({ actorId, action: 'task.assign', entityType: 'task', entityId: null, after: { assigneeId: userId, tasks: taken.raw } }, m);
      }
      if (inquiry.status === 'new') {
        await m.getRepository(Inquiry).update(id, { status: 'assigned' });
        await m.getRepository(StatusEvent).insert({ inquiryId: id, actorId, fromStatus: 'new', toStatus: 'assigned', note: `Assigned to ${user.email}` });
      }
      await this.audit.log({ actorId, action: 'inquiry.assign', entityType: 'inquiry', entityId: id, after: { userId } }, m);
    });
    if (userId !== actorId) {
      const [info] = await this.ds.query(
        `SELECT c.first_name, c.last_name, co.name AS company, u.email AS actor,
                (SELECT count(*)::int FROM tasks t WHERE t.inquiry_id = $1 AND t.assignee_id = $2 AND t.completed_at IS NULL) AS tasks
         FROM inquiries i JOIN contacts c ON c.id = i.contact_id LEFT JOIN companies co ON co.id = i.company_id
         LEFT JOIN users u ON u.id = $3 WHERE i.id = $1`, [id, userId, actorId]);
      await this.email.notifyStaff('lead.assigned', 'lead_assigned', {
        inquiryId: id, referenceNo: inquiry.referenceNo, contactName: [info?.first_name, info?.last_name].filter(Boolean).join(' '),
        companyName: info?.company, status: 'assigned', assignedBy: info?.actor, taskCount: info?.tasks ?? 0,
      }, { people: [user.email], inquiryId: id });
    }
    return this.assignments.findOneByOrFail({ inquiryId: id, unassignedAt: IsNull() });
  }

  async unassign(id: string, actorId: string) {
    await this.assignments.update({ inquiryId: id, unassignedAt: IsNull() }, { unassignedAt: new Date() });
    await this.audit.log({ actorId, action: 'inquiry.unassign', entityType: 'inquiry', entityId: id });
    return { ok: true };
  }
}

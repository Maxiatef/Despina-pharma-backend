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
import type { FormType, InquiryStatus } from '../../common/enums.js';
import { csvCell, paged } from '../../common/utils.js';
import { verifyUploadToken } from '../documents/upload-token.js';
import { maxFiles } from '../documents/documents.service.js';
import { InquiryQueryDto, SubmitInquiryDto } from './dto/inquiry.dto.js';

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

    try {
      return await this.ds.transaction(async (m) => {
        const company = dto.company ? await this.upsertCompany(m, dto.company) : null;
        const contact = await this.upsertContact(m, dto.contact, company?.id ?? null);

        const [{ seq }] = await m.query(`SELECT nextval('inquiry_reference_seq')::int AS seq`);
        const referenceNo = `DP-INQ-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

        const inquiry = await m.getRepository(Inquiry).save(
          m.getRepository(Inquiry).create({
            referenceNo,
            formType: dto.formType,
            status: 'new',
            contactId: contact.id,
            companyId: company?.id ?? null,
            message: dto.message ?? null,
            payload: dto.payload ?? {},
            sourcePage: dto.sourcePage ?? null,
            idempotencyKey: dto.idempotencyKey,
            ip: meta.ip,
            userAgent: meta.userAgent,
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

        // Two separate emails: one to the owner/department, one acknowledgement to the customer.
        const data = {
          inquiryId: inquiry.id,
          referenceNo,
          formType: dto.formType,
          contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
          contactEmail: contact.email,
          companyName: company?.name,
          sourcePage: dto.sourcePage,
          message: dto.message,
          items: items.map((i) => i.label),
        };
        for (const to of this.ownerRecipients(dto.formType)) {
          await this.email.queue({ kind: 'owner_notice', to, template: 'owner_notice', data, inquiryId: inquiry.id }, m);
        }
        await this.email.queue({ kind: 'customer_ack', to: contact.email, template: 'customer_ack', data, inquiryId: inquiry.id }, m);

        return { id: inquiry.id, referenceNo, status: inquiry.status, duplicate: false };
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

  /** OWNER_NOTIFICATION_EMAIL, optionally overridden per form type, e.g. NOTIFY_SAMPLE_REQUEST=lab@... */
  private ownerRecipients(formType: FormType): string[] {
    const specific = process.env[`NOTIFY_${formType.toUpperCase()}`];
    const list = (specific || this.email.ownerEmail || '').split(',').map((s) => s.trim()).filter(Boolean);
    return [...new Set(list)];
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

  private async upsertContact(m: EntityManager, input: SubmitInquiryDto['contact'], companyId: string | null) {
    const repo = m.getRepository(Contact);
    const qb = repo.createQueryBuilder('c').where('lower(c.email) = lower(:email)', { email: input.email });
    if (companyId) qb.andWhere('(c.company_id = :companyId OR c.company_id IS NULL)', { companyId });
    const found = await qb.orderBy('c.updatedAt', 'DESC').getOne();
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
      saved.push({ label: [catalogItem?.name, service?.title, it.notes].filter(Boolean).join(' – ') });
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
    if (q.formType) qb.andWhere('i.formType = :formType', { formType: q.formType });
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
      FROM inquiries i`);
    return row;
  }

  async exportCsv(q: InquiryQueryDto) {
    const qb = this.baseQuery(q).take(10_000);
    const { entities, raw } = await qb.getRawAndEntities();
    const rows = this.shape(entities, raw);
    const header = ['reference_no', 'created_at', 'form_type', 'status', 'first_name', 'last_name', 'email', 'company', 'assignee', 'source_page', 'message'];
    const lines = rows.map((r) =>
      [r.referenceNo, r.createdAt, r.formType, r.status, r.contact.firstName, r.contact.lastName, r.contact.email,
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
    const user = await this.users.findOneBy({ id: userId, isActive: true });
    if (!user || !STAFF_ROLES.includes(user.role)) throw new ForbiddenException('Leads can only be assigned to active staff');

    await this.ds.transaction(async (m) => {
      await m.getRepository(Assignment).update({ inquiryId: id, unassignedAt: IsNull() }, { unassignedAt: new Date() });
      await m.getRepository(Assignment).insert({ inquiryId: id, userId, assignedBy: actorId });
      if (inquiry.status === 'new') {
        await m.getRepository(Inquiry).update(id, { status: 'assigned' });
        await m.getRepository(StatusEvent).insert({ inquiryId: id, actorId, fromStatus: 'new', toStatus: 'assigned', note: `Assigned to ${user.email}` });
      }
      await this.audit.log({ actorId, action: 'inquiry.assign', entityType: 'inquiry', entityId: id, after: { userId } }, m);
    });
    await this.email.queue({
      kind: 'staff_alert', to: user.email, template: 'staff_alert', inquiryId: id,
      data: { title: `Lead ${inquiry.referenceNo} assigned to you`, body: `Open: ${process.env.APP_URL ?? ''}/admin/inquiries/${id}` },
    });
    return this.assignments.findOneByOrFail({ inquiryId: id, unassignedAt: IsNull() });
  }

  async unassign(id: string, actorId: string) {
    await this.assignments.update({ inquiryId: id, unassignedAt: IsNull() }, { unassignedAt: new Date() });
    await this.audit.log({ actorId, action: 'inquiry.unassign', entityType: 'inquiry', entityId: id });
    return { ok: true };
  }
}

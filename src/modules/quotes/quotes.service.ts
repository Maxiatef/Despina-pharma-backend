import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Approval, Quote, QuoteLine, QuoteResponse, QuoteVersion, StatusEvent, Task } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { EmailService } from '../email/email.service.js';
import { isStaff, ProjectAccessService, requireStaff } from '../projects/project-access.service.js';
import { QuoteResponseDto, QuoteVersionDto } from './dto/quotes.dto.js';
import { addBusinessHours, businessConfig } from '../../common/business-hours.js';

const cents = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class QuotesService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}
  async listQuotes(user: AuthUser, projectId: string) {
    await this.access.project(user, projectId);
    const quotes = await this.ds.getRepository(Quote).find({ where: { projectId }, order: { createdAt: 'DESC' } });
    return isStaff(user) ? quotes : quotes.filter((q) => q.status !== 'draft');
  }

  async createQuote(user: AuthUser, projectId: string, dto: QuoteVersionDto) {
    requireStaff(user);
    const project = await this.access.project(user, projectId);
    const quoteId = await this.ds.transaction(async (m) => {
      const [{ n }] = await m.query(`SELECT count(*)::int + 1 AS n FROM quotes WHERE project_id = $1`, [projectId]);
      const quote = await m.getRepository(Quote).save(
        m.getRepository(Quote).create({ projectId, quoteNo: `${project.code}-Q${n}`, status: 'draft', createdBy: user.id }),
      );
      await this.writeQuoteVersion(m, quote.id, 1, dto);
      return quote.id;
    });
    await this.audit.log({ actorId: user.id, action: 'quote.create', entityType: 'quote', entityId: quoteId });
    return this.getQuote(user, quoteId);
  }

  private async writeQuoteVersion(m: EntityManager, quoteId: string, versionNo: number, dto: QuoteVersionDto) {
    const lines = dto.lines.map((l, i) => ({ ...l, lineTotal: cents(l.quantity * l.unitPrice), sortOrder: i }));
    const total = cents(lines.reduce((s, l) => s + l.lineTotal, 0));
    const version = await m.getRepository(QuoteVersion).save(
      m.getRepository(QuoteVersion).create({
        quoteId, versionNo, currency: (dto.currency ?? 'USD').toUpperCase(), total: total.toFixed(2),
        validUntil: dto.validUntil ?? null, documentVersionId: dto.documentVersionId ?? null,
      }),
    );
    await m.getRepository(QuoteLine).insert(
      lines.map((l) => ({
        quoteVersionId: version.id, projectProductId: l.projectProductId ?? null, description: l.description,
        quantity: l.quantity.toFixed(2), unitPrice: l.unitPrice.toFixed(4), lineTotal: l.lineTotal.toFixed(2), sortOrder: l.sortOrder,
      })),
    );
    return version;
  }

  async getQuote(user: AuthUser, quoteId: string) {
    const { quote } = await this.access.quote(user, quoteId);
    const versions = await this.ds.getRepository(QuoteVersion).find({ where: { quoteId }, order: { versionNo: 'DESC' } });
    const lines = versions.length
      ? await this.ds.getRepository(QuoteLine).find({ where: { quoteVersionId: In(versions.map((v) => v.id)) }, order: { sortOrder: 'ASC' } })
      : [];
    const approvals = versions.length
      ? await this.ds.getRepository(Approval).find({ where: { quoteVersionId: In(versions.map((v) => v.id)) } })
      : [];
    const responses = versions.length
      ? await this.ds.getRepository(QuoteResponse).find({ where: { quoteId }, order: { createdAt: 'DESC' } })
      : [];
    return {
      ...quote,
      versions: versions.map((v) => ({
        ...v, lines: lines.filter((l) => l.quoteVersionId === v.id), approvals: approvals.filter((a) => a.quoteVersionId === v.id),
        responses: responses.filter((r) => r.quoteVersionId === v.id),
      })),
    };
  }

  /** A revised quote is a new version; an old acceptance never carries over. */
  async reviseQuote(user: AuthUser, quoteId: string, dto: QuoteVersionDto) {
    requireStaff(user);
    const { quote } = await this.access.quote(user, quoteId);
    if (quote.status === 'accepted') throw new ConflictException('Accepted quotes cannot be revised; create a new quote');
    await this.ds.transaction(async (m) => {
      const last = await m.getRepository(QuoteVersion).findOne({ where: { quoteId }, order: { versionNo: 'DESC' } });
      await this.writeQuoteVersion(m, quoteId, (last?.versionNo ?? 0) + 1, dto);
      if (quote.status !== 'draft') await m.getRepository(Quote).update(quoteId, { status: 'draft' });
    });
    return this.getQuote(user, quoteId);
  }

  async sendQuote(user: AuthUser, quoteId: string) {
    requireStaff(user);
    const { quote, project } = await this.access.quote(user, quoteId);
    if (quote.status !== 'draft') throw new BadRequestException('Only draft quotes can be sent');
    await this.ds.getRepository(Quote).update(quoteId, { status: 'sent' });
    for (const to of await this.access.customerEmails(project.companyId)) {
      await this.email.queue({ kind: 'quote_notice', to, template: 'quote_notice', projectId: project.id, data: { quoteNo: quote.quoteNo, projectId: project.id } });
    }
    await this.ds.query(`UPDATE inquiries SET status = 'quoted' WHERE id = $1 AND status IN ('new','assigned','awaiting_customer','qualified')`, [project.sourceInquiryId]);
    await this.audit.log({ actorId: user.id, action: 'quote.send', entityType: 'quote', entityId: quoteId });
    return this.getQuote(user, quoteId);
  }

  /**
   * The customer declines a sent quote or asks for changes to it. Bound to the exact (latest) version.
   * Staff get a follow-up task + alert; "changes requested" quotes can then be revised and sent again.
   */
  async respond(user: AuthUser, quoteId: string, dto: QuoteResponseDto) {
    const { quote, project } = await this.access.quote(user, quoteId);
    if (quote.status !== 'sent') throw new BadRequestException('Only a quote waiting for your answer can be declined or changed');
    const latest = await this.ds.getRepository(QuoteVersion).findOne({ where: { quoteId }, order: { versionNo: 'DESC' } });
    if (!latest || latest.id !== dto.quoteVersionId) throw new BadRequestException('Only the latest quote version can be answered');
    const declined = dto.decision === 'declined';
    const note = dto.note?.trim() || null;
    const label = declined ? 'declined' : 'asked for changes to';
    const cfg = businessConfig();
    await this.ds.transaction(async (m) => {
      await m.getRepository(QuoteResponse).insert({ quoteId, quoteVersionId: latest.id, decision: dto.decision, note, respondedBy: user.id });
      await m.getRepository(Quote).update(quoteId, { status: declined ? 'rejected' : 'changes_requested' });
      await m.getRepository(StatusEvent).insert({
        projectId: project.id, actorId: user.id,
        note: `Customer ${label} quote ${quote.quoteNo} v${latest.versionNo}${note ? `: ${note}` : ''}`.slice(0, 5000),
      });
      await m.getRepository(Task).insert({
        projectId: project.id, assigneeId: project.ownerId, createdBy: user.id, priority: 'high',
        title: declined ? `Quote ${quote.quoteNo} declined – contact the customer` : `Revise quote ${quote.quoteNo} (changes requested)`,
        dueAt: addBusinessHours(new Date(), cfg.followUpHours, cfg),
      });
      await this.audit.log({ actorId: user.id, action: `quote.${dto.decision}`, entityType: 'quote', entityId: quoteId, after: { versionId: latest.id, note } }, m);
    });
    for (const to of await this.access.staffEmails(project)) {
      await this.email.queue({
        kind: 'staff_alert', to, template: 'staff_alert', projectId: project.id,
        data: {
          title: `Customer ${label} quote ${quote.quoteNo}`,
          body: [`Project: ${project.code} – ${project.name}`, `Version: ${latest.versionNo}`, note ? `Note: ${note}` : '', `Open: ${process.env.APP_URL ?? ''}/admin/projects/${project.id}`].filter(Boolean).join('\n'),
        },
      });
    }
    return this.getQuote(user, quoteId);
  }

  async setQuoteStatus(user: AuthUser, quoteId: string, status: Quote['status']) {
    requireStaff(user);
    await this.access.quote(user, quoteId);
    if (status === 'accepted') throw new BadRequestException('Quotes are accepted through an approval of the exact version');
    await this.ds.getRepository(Quote).update(quoteId, { status });
    await this.audit.log({ actorId: user.id, action: 'quote.status', entityType: 'quote', entityId: quoteId, after: { status } });
    return this.getQuote(user, quoteId);
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Approval, Brief, BriefVersion, Document, DocumentVersion, Quote, QuoteLine, QuoteVersion, Sample, SampleRevision } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../email/email.service.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { sha256, stableJson } from '../../common/utils.js';
import type { ApprovalTarget } from '../../common/enums.js';
import { isStaff, ProjectAccessService } from '../projects/project-access.service.js';
import { CreateApprovalDto } from './dto/approvals.dto.js';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  /** What was approved, in words, for the e-mails. */
  private async describe(approval: Approval) {
    const one = async (sql: string, id: string | null) => (id ? ((await this.ds.query(sql, [id]))[0] ?? {}) : {});
    switch (approval.targetType) {
      case 'quote_version': {
        const r = await one(`SELECT q.quote_no, v.version_no, v.total, v.currency FROM quote_versions v JOIN quotes q ON q.id = v.quote_id WHERE v.id = $1`, approval.quoteVersionId);
        return { what: `quote ${r.quote_no} (version ${r.version_no})`, quote: r };
      }
      case 'sample_revision': {
        const r = await one(`SELECT s.title, sr.revision_no FROM sample_revisions sr JOIN samples s ON s.id = sr.sample_id WHERE sr.id = $1`, approval.sampleRevisionId);
        return { what: `sample "${r.title}" revision ${r.revision_no}` };
      }
      case 'document_version': {
        const r = await one(`SELECT d.title, v.version_no FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = $1`, approval.documentVersionId);
        return { what: `document "${r.title}" version ${r.version_no}` };
      }
      default: {
        const r = await one(`SELECT b.title, v.version_no FROM brief_versions v JOIN briefs b ON b.id = v.brief_id WHERE v.id = $1`, approval.briefVersionId);
        return { what: `brief "${r.title}" version ${r.version_no}` };
      }
    }
  }
  listApprovals(user: AuthUser, projectId: string) {
    return this.access.project(user, projectId).then(() =>
      this.ds.getRepository(Approval).find({ where: { projectId }, order: { approvedAt: 'DESC' } }),
    );
  }

  /**
   * Each approval is tied to one immutable version and stores its hash, so it can
   * never silently apply to a newer version.
   */
  async approve(user: AuthUser, projectId: string, dto: CreateApprovalDto) {
    const project = await this.access.project(user, projectId);
    const { hash, column } = await this.resolveTarget(projectId, dto.targetType, dto.targetId, user);

    const approval = await this.ds.transaction(async (m) => {
      const repo = m.getRepository(Approval);
      if (await repo.existsBy({ [column]: dto.targetId, approverId: user.id } as any)) {
        throw new ConflictException('You already approved this version');
      }
      const saved = await repo.save(
        repo.create({
          projectId, targetType: dto.targetType, [column]: dto.targetId, targetHash: hash,
          approverId: user.id, approverRole: user.role, confirmationText: dto.confirmationText, approvedAt: new Date(),
        } as Partial<Approval>),
      );
      if (dto.targetType === 'quote_version') {
        const v = await m.getRepository(QuoteVersion).findOneByOrFail({ id: dto.targetId });
        await m.getRepository(Quote).update(v.quoteId, { status: 'accepted' });
        if (project.sourceInquiryId) await m.query(`UPDATE inquiries SET status = 'won' WHERE id = $1 AND status <> 'won'`, [project.sourceInquiryId]);
      }
      if (dto.targetType === 'sample_revision') {
        const r = await m.getRepository(SampleRevision).findOneByOrFail({ id: dto.targetId });
        await m.getRepository(Sample).update(r.sampleId, { status: 'approved' });
      }
      await this.audit.log({ actorId: user.id, action: 'approval.create', entityType: 'approval', entityId: saved.id, after: saved }, m);
      return saved;
    });
    if (!isStaff(user)) {
      const { what, quote } = await this.describe(approval);
      const data = {
        projectId, projectCode: project.code, projectName: project.name, customerEmail: user.email, what,
        confirmationText: approval.confirmationText,
      };
      if (quote) {
        const q = { ...data, quoteNo: quote.quote_no, versionNo: quote.version_no, total: quote.total, currency: quote.currency, decision: 'accepted' };
        await this.email.notifyStaff('quote.response', 'quote_response_staff', q, { people: await this.access.ownerEmails(project), projectId });
        await this.email.toCustomer('quote_response_ack', user.email, 'quote_response_ack', q, { projectId });
      } else {
        await this.email.notifyStaff('approval.received', 'approval_staff', data, { people: await this.access.ownerEmails(project), projectId });
      }
    }
    return approval;
  }

  private async resolveTarget(projectId: string, type: ApprovalTarget, id: string, user: AuthUser) {
    const m = this.ds.manager;
    const notFound = () => new NotFoundException('Version not found in this project');
    switch (type) {
      case 'document_version': {
        const v = await m.getRepository(DocumentVersion).findOneBy({ id });
        const doc = v && (await m.getRepository(Document).findOneBy({ id: v.documentId }));
        if (!v || !doc || doc.projectId !== projectId) throw notFound();
        if (!isStaff(user) && doc.visibility !== 'customer') throw notFound();
        if (v.scanStatus !== 'clean') throw new BadRequestException('File has not passed the security scan');
        const latest = await m.getRepository(DocumentVersion).findOne({ where: { documentId: doc.id }, order: { versionNo: 'DESC' } });
        if (latest?.id !== v.id) throw new BadRequestException('Only the latest version can be approved');
        return { hash: v.sha256, column: 'documentVersionId' };
      }
      case 'sample_revision': {
        const r = await m.getRepository(SampleRevision).findOneBy({ id });
        const sample = r && (await m.getRepository(Sample).findOneBy({ id: r.sampleId }));
        const ok = sample && (await m.query(`SELECT 1 FROM project_products WHERE id = $1 AND project_id = $2`, [sample.projectProductId, projectId])).length;
        if (!r || !ok) throw notFound();
        return { hash: sha256(stableJson({ id: r.id, sampleId: r.sampleId, revisionNo: r.revisionNo, description: r.description })), column: 'sampleRevisionId' };
      }
      case 'quote_version': {
        const v = await m.getRepository(QuoteVersion).findOneBy({ id });
        const quote = v && (await m.getRepository(Quote).findOneBy({ id: v.quoteId }));
        if (!v || !quote || quote.projectId !== projectId) throw notFound();
        if (quote.status !== 'sent') throw new BadRequestException('Only sent quotes can be accepted');
        const latest = await m.getRepository(QuoteVersion).findOne({ where: { quoteId: quote.id }, order: { versionNo: 'DESC' } });
        if (latest?.id !== v.id) throw new BadRequestException('Only the latest quote version can be accepted');
        const lines = await m.getRepository(QuoteLine).find({ where: { quoteVersionId: v.id }, order: { sortOrder: 'ASC' } });
        return {
          hash: sha256(stableJson({
            id: v.id, currency: v.currency, total: v.total, validUntil: v.validUntil,
            lines: lines.map((l) => [l.description, l.quantity, l.unitPrice, l.lineTotal]),
            // Only when set, so approvals of versions without terms keep their original fingerprint.
            ...(Object.keys(v.terms ?? {}).length ? { terms: v.terms } : {}),
          })),
          column: 'quoteVersionId',
        };
      }
      case 'brief_version': {
        const v = await m.getRepository(BriefVersion).findOneBy({ id });
        const brief = v && (await m.getRepository(Brief).findOneBy({ id: v.briefId }));
        const ok = brief && (await m.query(`SELECT 1 FROM project_products WHERE id = $1 AND project_id = $2`, [brief.projectProductId, projectId])).length;
        if (!v || !ok) throw notFound();
        const latest = await m.getRepository(BriefVersion).findOne({ where: { briefId: v.briefId }, order: { versionNo: 'DESC' } });
        if (latest?.id !== v.id) throw new BadRequestException('Only the latest brief version can be approved');
        return { hash: sha256(stableJson({ id: v.id, content: v.content })), column: 'briefVersionId' };
      }
    }
  }
}

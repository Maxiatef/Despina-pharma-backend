import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Approval, Feedback, Project, Sample, SampleRevision, StatusEvent } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../email/email.service.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { isStaff, ProjectAccessService, requireStaff } from '../projects/project-access.service.js';
import { CreateSampleDto, UpdateSampleDto, CreateSampleRevisionDto, UpdateSampleRevisionDto, CreateFeedbackDto } from './dto/samples.dto.js';

@Injectable()
export class SamplesService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  /** Everything the sample e-mails need about one revision. */
  private async revisionContext(revisionId: string) {
    const [r] = await this.ds.query(
      `SELECT sr.id, sr.revision_no, sr.description, sr.tracking_no, sr.shipped_at, s.id AS sample_id, s.title AS sample_title,
              pp.name AS product_name, p.id AS project_id, p.code AS project_code, p.name AS project_name, p.company_id, p.owner_id
       FROM sample_revisions sr JOIN samples s ON s.id = sr.sample_id JOIN project_products pp ON pp.id = s.project_product_id
       JOIN projects p ON p.id = pp.project_id WHERE sr.id = $1`, [revisionId]);
    if (!r) return null;
    return {
      row: r,
      data: {
        projectId: r.project_id, projectCode: r.project_code, projectName: r.project_name, sampleTitle: r.sample_title,
        revisionNo: r.revision_no, productName: r.product_name, trackingNo: r.tracking_no, shippedAt: r.shipped_at, description: r.description,
      },
    };
  }

  private async notifyShipped(revisionId: string) {
    const ctx = await this.revisionContext(revisionId);
    if (!ctx) return;
    for (const to of await this.access.customerEmails(ctx.row.company_id)) {
      await this.email.toCustomer('sample_shipped', to, 'sample_shipped', ctx.data, { projectId: ctx.row.project_id });
    }
  }

  /** Staff ask the customer for feedback on one revision. */
  async requestFeedback(user: AuthUser, revisionId: string) {
    requireStaff(user);
    await this.access.sampleRevision(user, revisionId);
    const ctx = await this.revisionContext(revisionId);
    if (!ctx) throw new NotFoundException('Sample revision not found');
    const to = await this.access.customerEmails(ctx.row.company_id);
    if (!to.length) throw new BadRequestException('Nobody from this company has a workspace account yet – invite the customer first');
    const jobs = [];
    for (const address of to) jobs.push(await this.email.toCustomer('feedback_request', address, 'feedback_request', ctx.data, { projectId: ctx.row.project_id }));
    if (jobs.every((j) => j === null)) throw new BadRequestException('"Sample feedback request" e-mails are switched off in Settings → Emails');
    await this.ds.getRepository(StatusEvent).insert({ projectId: ctx.row.project_id, actorId: user.id, note: `Feedback requested for "${ctx.row.sample_title}" revision ${ctx.row.revision_no}` });
    return { sentTo: to };
  }
  async listSamples(user: AuthUser, productId: string) {
    await this.access.product(user, productId);
    return this.ds.getRepository(Sample).find({ where: { projectProductId: productId }, order: { createdAt: 'ASC' } });
  }

  async createSample(user: AuthUser, productId: string, dto: CreateSampleDto) {
    const { project } = await this.access.product(user, productId);
    const repo = this.ds.getRepository(Sample);
    const sample = await repo.save(repo.create({ projectProductId: productId, title: dto.title, inquiryId: dto.inquiryId ?? null, status: 'requested' }));
    await this.audit.log({ actorId: user.id, action: 'sample.create', entityType: 'sample', entityId: sample.id, after: { projectId: project.id } });
    return sample;
  }

  async getSample(user: AuthUser, sampleId: string) {
    const { sample } = await this.access.sample(user, sampleId);
    const revisions = await this.ds.getRepository(SampleRevision).find({ where: { sampleId }, order: { revisionNo: 'ASC' } });
    const feedback = revisions.length
      ? await this.ds.getRepository(Feedback).find({ where: { sampleRevisionId: In(revisions.map((r) => r.id)) }, order: { createdAt: 'ASC' } })
      : [];
    return { ...sample, revisions: revisions.map((r) => ({ ...r, feedback: feedback.filter((f) => f.sampleRevisionId === r.id) })) };
  }

  async updateSample(user: AuthUser, sampleId: string, dto: UpdateSampleDto) {
    requireStaff(user);
    const { sample } = await this.access.sample(user, sampleId);
    await this.ds.getRepository(Sample).update(sampleId, dto);
    await this.audit.log({ actorId: user.id, action: 'sample.update', entityType: 'sample', entityId: sampleId, before: sample, after: dto });
    return this.getSample(user, sampleId);
  }

  async addRevision(user: AuthUser, sampleId: string, dto: CreateSampleRevisionDto) {
    requireStaff(user);
    await this.access.sample(user, sampleId);
    const repo = this.ds.getRepository(SampleRevision);
    const last = await repo.findOne({ where: { sampleId }, order: { revisionNo: 'DESC' } });
    const revision = await repo.save(
      repo.create({
        sampleId, revisionNo: (last?.revisionNo ?? 0) + 1, description: dto.description ?? null,
        shippedAt: dto.shippedAt ? new Date(dto.shippedAt) : null, trackingNo: dto.trackingNo ?? null, createdBy: user.id,
      }),
    );
    await this.ds.getRepository(Sample).update(sampleId, { status: dto.shippedAt ? 'shipped' : 'in_development' });
    if (revision.shippedAt) await this.notifyShipped(revision.id);
    return revision;
  }

  async updateRevision(user: AuthUser, revisionId: string, dto: UpdateSampleRevisionDto) {
    requireStaff(user);
    const { revision } = await this.access.sampleRevision(user, revisionId);
    const approved = await this.ds.getRepository(Approval).existsBy({ sampleRevisionId: revisionId });
    if (approved && dto.description !== undefined) throw new ConflictException('Approved revisions cannot change; create a new revision');
    await this.ds.getRepository(SampleRevision).update(revisionId, {
      ...dto, shippedAt: dto.shippedAt ? new Date(dto.shippedAt) : revision.shippedAt,
    });
    if (dto.shippedAt) await this.ds.getRepository(Sample).update(revision.sampleId, { status: 'shipped' });
    if (dto.shippedAt && !revision.shippedAt) await this.notifyShipped(revisionId);
    return this.ds.getRepository(SampleRevision).findOneByOrFail({ id: revisionId });
  }

  async addFeedback(user: AuthUser, revisionId: string, dto: CreateFeedbackDto) {
    const { revision } = await this.access.sampleRevision(user, revisionId);
    const repo = this.ds.getRepository(Feedback);
    const fb = await repo.save(repo.create({ sampleRevisionId: revisionId, authorId: user.id, rating: dto.rating ?? null, comments: dto.comments ?? null }));
    if (!isStaff(user)) {
      await this.ds.getRepository(Sample).update(revision.sampleId, { status: 'feedback_received' });
      const ctx = await this.revisionContext(revisionId);
      if (ctx) {
        const project = await this.ds.getRepository(Project).findOneByOrFail({ id: ctx.row.project_id });
        await this.email.notifyStaff('sample.feedback', 'sample_feedback_staff',
          { ...ctx.data, rating: dto.rating, comments: dto.comments, customerEmail: user.email },
          { people: await this.access.ownerEmails(project), projectId: project.id });
      }
    }
    return fb;
  }
}

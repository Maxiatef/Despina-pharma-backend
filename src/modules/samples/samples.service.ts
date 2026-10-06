import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Approval, Feedback, Sample, SampleRevision } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { isStaff, ProjectAccessService, requireStaff } from '../projects/project-access.service.js';
import { CreateSampleDto, UpdateSampleDto, CreateSampleRevisionDto, UpdateSampleRevisionDto, CreateFeedbackDto } from './dto/samples.dto.js';

@Injectable()
export class SamplesService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}
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
    return this.ds.getRepository(SampleRevision).findOneByOrFail({ id: revisionId });
  }

  async addFeedback(user: AuthUser, revisionId: string, dto: CreateFeedbackDto) {
    const { revision } = await this.access.sampleRevision(user, revisionId);
    const repo = this.ds.getRepository(Feedback);
    const fb = await repo.save(repo.create({ sampleRevisionId: revisionId, authorId: user.id, rating: dto.rating ?? null, comments: dto.comments ?? null }));
    if (!isStaff(user)) await this.ds.getRepository(Sample).update(revision.sampleId, { status: 'feedback_received' });
    return fb;
  }
}

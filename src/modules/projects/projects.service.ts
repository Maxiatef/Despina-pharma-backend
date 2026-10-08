import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import {
  CatalogItem, Company, Contact, Inquiry, InquiryItem, Project, ProjectProduct, ProjectStage, Quote, Sample,
  Service, StageTemplate, StatusEvent, User,
} from '../../database/entities/index.js';
import type { StageDefinition } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { paged } from '../../common/utils.js';
import { isStaff, ProjectAccessService } from './project-access.service.js';
import { ConvertToProjectDto } from '../inquiries/dto/inquiry.dto.js';
import {
  CreateProjectDto, CreateProjectProductDto, ProjectQueryDto, UpdateProjectDto, UpdateProjectProductDto,
} from './dto/project.dto.js';

/** Used when no stage template exists yet (matches the brief). */
export const DEFAULT_STAGES: StageDefinition[] = [
  { name: 'Inquiry' },
  { name: 'Discovery' },
  { name: 'Formulation' },
  { name: 'Sampling' },
  { name: 'Quotation' },
  { name: 'Approval' },
  { name: 'Packaging & Artwork' },
  { name: 'Production' },
  { name: 'Quality Release', requiresRole: 'quality' },
  { name: 'Dispatch' },
  { name: 'Completed' },
];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
  ) {}

  // ---------- projects ----------
  private async nextCode(m: EntityManager) {
    const year = new Date().getFullYear();
    const [{ n }] = await m.query(`SELECT count(*)::int + 1 AS n FROM projects WHERE code LIKE $1`, [`DP-PRJ-${year}-%`]);
    return `DP-PRJ-${year}-${String(n).padStart(4, '0')}`;
  }

  private async createStages(m: EntityManager, projectId: string, templateId: string | null | undefined) {
    const repo = m.getRepository(StageTemplate);
    const template = templateId ? await repo.findOneBy({ id: templateId }) : await repo.findOneBy({ isDefault: true });
    if (templateId && !template) throw new BadRequestException('Stage template not found');
    const defs = template?.stages?.length ? template.stages : DEFAULT_STAGES;
    const stages = await m.getRepository(ProjectStage).save(
      defs.map((d, i) =>
        m.getRepository(ProjectStage).create({
          projectId, name: d.name, sortOrder: i, requiresRole: d.requiresRole ?? null, startedAt: i === 0 ? new Date() : null,
        }),
      ),
    );
    await m.getRepository(Project).update(projectId, { currentStageId: stages[0].id, stageTemplateId: template?.id ?? null });
    return stages;
  }

  /**
   * Each product line gets its own stage track (copied from a template) so e.g. a packaging-only line
   * is not forced through formulation. Uses the given template, else the project's, else the default one.
   */
  private async createProductStages(m: EntityManager, product: ProjectProduct, templateId?: string | null) {
    const repo = m.getRepository(StageTemplate);
    const project = await m.getRepository(Project).findOneByOrFail({ id: product.projectId });
    const id = templateId ?? project.stageTemplateId;
    const template = id ? await repo.findOneBy({ id }) : await repo.findOneBy({ isDefault: true });
    if (templateId && !template) throw new BadRequestException('Stage template not found');
    const defs = template?.stages?.length ? template.stages : DEFAULT_STAGES;
    const stages = await m.getRepository(ProjectStage).save(
      defs.map((d, i) =>
        m.getRepository(ProjectStage).create({
          projectId: product.projectId, projectProductId: product.id, name: d.name, sortOrder: i,
          requiresRole: d.requiresRole ?? null, startedAt: i === 0 ? new Date() : null,
        }),
      ),
    );
    await m.getRepository(ProjectProduct).update(product.id, { currentStageId: stages[0].id });
    return stages;
  }

  private async insertProject(m: EntityManager, data: Partial<Project>) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await m.getRepository(Project).save(m.getRepository(Project).create({ ...data, code: await this.nextCode(m) }));
      } catch (e) {
        if ((e as any)?.code !== '23505' || attempt === 4) throw e;
      }
    }
    throw new ConflictException('Could not allocate a project code');
  }

  async create(dto: CreateProjectDto, actor: AuthUser) {
    const project = await this.ds.transaction(async (m) => {
      if (!(await m.getRepository(Company).findOneBy({ id: dto.companyId }))) throw new BadRequestException('Company not found');
      const p = await this.insertProject(m, { companyId: dto.companyId, name: dto.name, ownerId: dto.ownerId ?? actor.id });
      await this.createStages(m, p.id, dto.stageTemplateId);
      await this.audit.log({ actorId: actor.id, action: 'project.create', entityType: 'project', entityId: p.id, after: p }, m);
      return p;
    });
    return this.get(actor, project.id);
  }

  /** Turn a lead into a project without re-entering data: company, products and services are copied. */
  async convertFromInquiry(inquiryId: string, dto: ConvertToProjectDto, actor: AuthUser) {
    const projectId = await this.ds.transaction(async (m) => {
      const inquiry = await m.getRepository(Inquiry).findOneBy({ id: inquiryId });
      if (!inquiry) throw new NotFoundException('Inquiry not found');
      const already = await m.getRepository(Project).findOneBy({ sourceInquiryId: inquiryId });
      if (already) throw new ConflictException({ message: 'This inquiry was already converted', projectId: already.id });

      const contact = await m.getRepository(Contact).findOneByOrFail({ id: inquiry.contactId });
      let companyId = inquiry.companyId ?? contact.companyId;
      if (!companyId) {
        // Visitor gave no company: create one from the contact so the project has an owner company.
        const company = await m.getRepository(Company).save(
          m.getRepository(Company).create({ name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email, country: contact.country }),
        );
        companyId = company.id;
        await m.getRepository(Contact).update(contact.id, { companyId });
        await m.getRepository(Inquiry).update(inquiry.id, { companyId });
      }
      const company = await m.getRepository(Company).findOneByOrFail({ id: companyId });

      const project = await this.insertProject(m, {
        companyId, name: dto.name ?? `${company.name} – ${inquiry.referenceNo}`, ownerId: actor.id, sourceInquiryId: inquiry.id,
      });
      await this.createStages(m, project.id, dto.stageTemplateId);

      const items = await m.getRepository(InquiryItem).find({ where: { inquiryId } });
      const catalog = await m.getRepository(CatalogItem).findBy({ id: In(items.map((i) => i.catalogItemId).filter(Boolean) as string[]) });
      const services = await m.getRepository(Service).findBy({ id: In(items.map((i) => i.serviceId).filter(Boolean) as string[]) });
      for (const it of items) {
        const product = await m.getRepository(ProjectProduct).save({
          projectId: project.id,
          catalogItemId: it.catalogItemId,
          serviceId: it.serviceId,
          name: catalog.find((c) => c.id === it.catalogItemId)?.name ?? services.find((s) => s.id === it.serviceId)?.title ?? 'Product',
          targetQuantity: it.quantity,
          notes: it.notes,
        });
        await this.createProductStages(m, product, dto.stageTemplateId);
      }
      // Move inquiry messages, tasks and documents along with the project.
      await m.query(`UPDATE documents SET project_id = $1 WHERE inquiry_id = $2 AND project_id IS NULL`, [project.id, inquiryId]);

      if (dto.setStatus && dto.setStatus !== inquiry.status) {
        await m.getRepository(Inquiry).update(inquiryId, { status: dto.setStatus });
        await m.getRepository(StatusEvent).insert({
          inquiryId, projectId: project.id, actorId: actor.id, fromStatus: inquiry.status, toStatus: dto.setStatus, note: `Converted to project ${project.code}`,
        });
      } else {
        await m.getRepository(StatusEvent).insert({ inquiryId, projectId: project.id, actorId: actor.id, note: `Converted to project ${project.code}` });
      }
      await this.audit.log({ actorId: actor.id, action: 'inquiry.convert', entityType: 'project', entityId: project.id, after: { inquiryId } }, m);
      return project.id;
    });
    return this.get(actor, projectId);
  }

  async list(user: AuthUser, q: ProjectQueryDto) {
    const qb = this.ds.getRepository(Project)
      .createQueryBuilder('p')
      .innerJoin(Company, 'c', 'c.id = p.companyId')
      .leftJoin(ProjectStage, 'st', 'st.id = p.currentStageId')
      .addSelect(['c.name', 'st.name'])
      .orderBy('p.updatedAt', 'DESC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize);
    if (!isStaff(user)) {
      if (!user.companyIds.length) return paged([], 0, q);
      qb.andWhere('p.companyId IN (:...ids)', { ids: user.companyIds });
    }
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.companyId) qb.andWhere('p.companyId = :companyId', { companyId: q.companyId });
    if (q.ownerId) qb.andWhere('p.ownerId = :ownerId', { ownerId: q.ownerId });
    if (q.q) qb.andWhere('(p.name ILIKE :q OR p.code ILIKE :q OR c.name ILIKE :q)', { q: `%${q.q}%` });
    const [{ entities, raw }, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);
    const items = entities.map((e) => {
      const r = raw.find((x) => x.p_id === e.id) ?? {};
      return { ...e, companyName: r.c_name, currentStage: r.st_name ?? null };
    });
    return paged(items, total, q);
  }

  async get(user: AuthUser, id: string) {
    const project = await this.access.project(user, id);
    const m = this.ds.manager;
    const [company, stages, products, quotes, owner] = await Promise.all([
      m.getRepository(Company).findOneBy({ id: project.companyId }),
      m.getRepository(ProjectStage).find({ where: { projectId: id, projectProductId: IsNull() }, order: { sortOrder: 'ASC' } }),
      m.getRepository(ProjectProduct).find({ where: { projectId: id }, order: { createdAt: 'ASC' } }),
      m.getRepository(Quote).find({ where: { projectId: id }, order: { createdAt: 'DESC' } }),
      project.ownerId ? m.getRepository(User).findOneBy({ id: project.ownerId }) : null,
    ]);
    const [samples, productStages] = products.length
      ? await Promise.all([
          m.getRepository(Sample).find({ where: { projectProductId: In(products.map((p) => p.id)) }, order: { createdAt: 'ASC' } }),
          m.getRepository(ProjectStage).find({ where: { projectProductId: In(products.map((p) => p.id)) }, order: { sortOrder: 'ASC' } }),
        ])
      : [[], []];
    return {
      ...project,
      company,
      owner: owner ? { id: owner.id, email: owner.email } : null,
      stages,
      products: products.map((p) => {
        const own = productStages.filter((s) => s.projectProductId === p.id);
        return {
          ...p,
          samples: samples.filter((s) => s.projectProductId === p.id),
          stages: own,
          // Roll-up for the project view: counts only, no invented percentages.
          stageSummary: own.length
            ? { done: own.filter((s) => s.completedAt).length, total: own.length, current: own.find((s) => s.id === p.currentStageId)?.name ?? null }
            : null,
        };
      }),
      quotes: isStaff(user) ? quotes : quotes.filter((q) => q.status !== 'draft'),
    };
  }

  async update(user: AuthUser, id: string, dto: UpdateProjectDto) {
    const before = await this.access.project(user, id);
    await this.ds.getRepository(Project).update(id, dto);
    await this.audit.log({ actorId: user.id, action: 'project.update', entityType: 'project', entityId: id, before, after: dto });
    return this.get(user, id);
  }

  /**
   * Complete the current stage and start the next one. Gated stages (e.g. Quality Release) need the right role.
   * Works for the project-level track and for a product line's own track.
   */
  async completeStage(user: AuthUser, projectId: string, stageId: string, note?: string) {
    const project = await this.access.project(user, projectId);
    await this.ds.transaction(async (m) => {
      const target = await m.getRepository(ProjectStage).findOneBy({ id: stageId, projectId });
      if (!target) throw new NotFoundException('Stage not found');
      const product = target.projectProductId ? await m.getRepository(ProjectProduct).findOneByOrFail({ id: target.projectProductId }) : null;
      const stages = await m.getRepository(ProjectStage).find({
        where: { projectId, projectProductId: product ? product.id : IsNull() }, order: { sortOrder: 'ASC' },
      });
      const idx = stages.findIndex((s) => s.id === stageId);
      const stage = stages[idx];
      if (stage.completedAt) throw new BadRequestException('Stage already completed');
      if ((product ? product.currentStageId : project.currentStageId) !== stage.id) throw new BadRequestException('Only the current stage can be completed');
      if (stage.requiresRole && user.role !== stage.requiresRole && user.role !== 'admin') {
        throw new ForbiddenException(`Only ${stage.requiresRole} staff can complete "${stage.name}"`);
      }
      await m.getRepository(ProjectStage).update(stage.id, { completedAt: new Date(), completedBy: user.id });
      const next = stages[idx + 1];
      if (next) await m.getRepository(ProjectStage).update(next.id, { startedAt: new Date() });
      if (product) {
        // Last stage done → the line has no current stage any more (all complete).
        await m.getRepository(ProjectProduct).update(product.id, { currentStageId: next?.id ?? null });
      } else if (next) {
        await m.getRepository(Project).update(projectId, { currentStageId: next.id });
      } else {
        await m.getRepository(Project).update(projectId, { status: 'completed' });
      }
      const where = product ? ` for "${product.name}"` : '';
      await m.getRepository(StatusEvent).insert({ projectId, actorId: user.id, note: `Stage "${stage.name}"${where} completed${note ? `: ${note}` : ''}` });
      await this.audit.log({ actorId: user.id, action: 'project.stage_complete', entityType: 'project', entityId: projectId, after: { stageId, note } }, m);
    });
    return this.get(user, projectId);
  }

  timeline(user: AuthUser, projectId: string) {
    return this.access.project(user, projectId).then(() =>
      this.ds.getRepository(StatusEvent).find({ where: { projectId }, order: { createdAt: 'ASC' } }),
    );
  }

  // ---------- project products ("Add to project") ----------
  async addProduct(user: AuthUser, projectId: string, dto: CreateProjectProductDto) {
    await this.access.project(user, projectId);
    let name = dto.name;
    if (dto.catalogItemId) {
      const item = await this.ds.getRepository(CatalogItem).findOneBy({ id: dto.catalogItemId, isPublished: true });
      if (!item) throw new BadRequestException('Catalog item not found');
      name ??= item.name;
    }
    if (dto.serviceId) {
      const s = await this.ds.getRepository(Service).findOneBy({ id: dto.serviceId });
      if (!s) throw new BadRequestException('Service not found');
      name ??= s.title;
    }
    if (!name) throw new BadRequestException('Name, catalogItemId or serviceId is required');
    const product = await this.ds.transaction(async (m) => {
      const saved = await m.getRepository(ProjectProduct).save(m.getRepository(ProjectProduct).create({ ...dto, name, projectId }));
      await this.createProductStages(m, saved);
      return saved;
    });
    await this.audit.log({ actorId: user.id, action: 'project.product_add', entityType: 'project', entityId: projectId, after: product });
    return product;
  }

  /** Start (or restart, while nothing is completed yet) a product line's stage track from a template. */
  async startProductStages(user: AuthUser, productId: string, stageTemplateId?: string) {
    const { product, project } = await this.access.product(user, productId);
    await this.ds.transaction(async (m) => {
      const existing = await m.getRepository(ProjectStage).findBy({ projectProductId: product.id });
      if (existing.some((s) => s.completedAt)) throw new ConflictException('Stages of this product have already been completed; they cannot be replaced');
      if (existing.length) {
        await m.getRepository(ProjectProduct).update(product.id, { currentStageId: null });
        await m.getRepository(ProjectStage).delete({ projectProductId: product.id });
      }
      await this.createProductStages(m, product, stageTemplateId ?? null);
      await m.getRepository(StatusEvent).insert({ projectId: project.id, actorId: user.id, note: `Stages set for "${product.name}"` });
      await this.audit.log({ actorId: user.id, action: 'project.product_stages', entityType: 'project', entityId: project.id, after: { productId, stageTemplateId } }, m);
    });
    return this.get(user, project.id);
  }

  async updateProduct(user: AuthUser, productId: string, dto: UpdateProjectProductDto) {
    const { product } = await this.access.product(user, productId);
    const repo = this.ds.getRepository(ProjectProduct);
    return repo.save(repo.merge(product, dto));
  }

  async removeProduct(user: AuthUser, productId: string) {
    const { product } = await this.access.product(user, productId);
    if (!isStaff(user)) {
      const hasWork = await this.ds.getRepository(Sample).existsBy({ projectProductId: productId });
      if (hasWork) throw new ForbiddenException('This product already has samples; ask your Despina contact to remove it');
    }
    await this.ds.getRepository(ProjectProduct).delete(product.id);
    await this.audit.log({ actorId: user.id, action: 'project.product_remove', entityType: 'project', entityId: product.projectId, before: product });
    return { ok: true };
  }
}

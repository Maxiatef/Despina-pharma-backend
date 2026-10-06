import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Faq, Redirect, Service } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import {
  CreateFaqDto, CreateRedirectDto, CreateServiceDto, FaqQueryDto, UpdateFaqDto, UpdateRedirectDto, UpdateServiceDto,
} from './dto/content.dto.js';

const isUnique = (e: unknown) => e instanceof QueryFailedError && (e as { code?: string }).code === '23505';

/** Services, FAQs and redirects (admin CMS + public website reads). */
@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(Faq) private readonly faqs: Repository<Faq>,
    @InjectRepository(Redirect) private readonly redirects: Repository<Redirect>,
    private readonly audit: AuditService,
  ) {}

  private async save<T extends object>(repo: Repository<T>, entity: T) {
    try {
      return await repo.save(entity);
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A record with this slug/path already exists');
      throw e;
    }
  }

  // ---------- services ----------
  listServices(includeUnpublished: boolean) {
    return this.services.find({ where: includeUnpublished ? {} : { isPublished: true }, order: { sortOrder: 'ASC', title: 'ASC' } });
  }

  async getServiceBySlug(slug: string, includeUnpublished = false) {
    const service = await this.services.findOneBy(includeUnpublished ? { slug } : { slug, isPublished: true });
    if (!service) throw new NotFoundException('Service not found');
    const faqs = await this.faqs.find({ where: { serviceId: service.id, isPublished: true }, order: { sortOrder: 'ASC' } });
    return { ...service, faqs };
  }

  async createService(dto: CreateServiceDto, actorId: string) {
    const s = await this.save(this.services, this.services.create(dto));
    await this.audit.log({ actorId, action: 'service.create', entityType: 'service', entityId: s.id, after: s });
    return s;
  }

  async updateService(id: string, dto: UpdateServiceDto, actorId: string) {
    const before = await this.services.findOneBy({ id });
    if (!before) throw new NotFoundException('Service not found');
    const oldSlug = before.slug;
    const after = await this.save(this.services, this.services.merge(before, dto));
    if (dto.slug && dto.slug !== oldSlug) {
      await this.redirects.upsert({ fromPath: `/services/${oldSlug}/`, toPath: `/services/${after.slug}/`, statusCode: 301 }, ['fromPath']);
    }
    await this.audit.log({ actorId, action: 'service.update', entityType: 'service', entityId: id, after });
    return after;
  }

  // ---------- faqs ----------
  async listFaqs(q: FaqQueryDto, includeUnpublished: boolean) {
    const qb = this.faqs.createQueryBuilder('f').orderBy('f.sortOrder', 'ASC');
    if (!includeUnpublished) qb.andWhere('f.isPublished = true');
    if (q.topic) qb.andWhere('f.topic = :topic', { topic: q.topic });
    if (q.service) qb.innerJoin(Service, 's', 's.id = f.serviceId').andWhere('s.slug = :service', { service: q.service });
    return qb.getMany();
  }

  async createFaq(dto: CreateFaqDto, actorId: string) {
    const f = await this.faqs.save(this.faqs.create(dto));
    await this.audit.log({ actorId, action: 'faq.create', entityType: 'faq', entityId: f.id, after: f });
    return f;
  }

  async updateFaq(id: string, dto: UpdateFaqDto, actorId: string) {
    const f = await this.faqs.findOneBy({ id });
    if (!f) throw new NotFoundException('FAQ not found');
    const after = await this.faqs.save(this.faqs.merge(f, dto));
    await this.audit.log({ actorId, action: 'faq.update', entityType: 'faq', entityId: id, after });
    return after;
  }

  async deleteFaq(id: string, actorId: string) {
    await this.faqs.delete(id);
    await this.audit.log({ actorId, action: 'faq.delete', entityType: 'faq', entityId: id });
    return { ok: true };
  }

  // ---------- redirects ----------
  listRedirects() {
    return this.redirects.find({ order: { fromPath: 'ASC' } });
  }

  async resolveRedirect(path: string) {
    const normalized = path.endsWith('/') ? path : `${path}/`;
    const r = await this.redirects.findOne({ where: [{ fromPath: path }, { fromPath: normalized }] });
    if (!r) throw new NotFoundException('No redirect');
    return r;
  }

  createRedirect(dto: CreateRedirectDto) {
    return this.save(this.redirects, this.redirects.create(dto));
  }

  async updateRedirect(id: string, dto: UpdateRedirectDto) {
    const r = await this.redirects.findOneBy({ id });
    if (!r) throw new NotFoundException('Redirect not found');
    return this.save(this.redirects, this.redirects.merge(r, dto));
  }

  async deleteRedirect(id: string) {
    await this.redirects.delete(id);
    return { ok: true };
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CatalogCategory, CatalogItem, CatalogSource, Redirect } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import { paged } from '../../common/utils.js';
import {
  CreateCategoryDto, CreateItemDto, CreateSourceDto, ItemQueryDto, UpdateCategoryDto, UpdateItemDto, UpdateSourceDto,
} from './dto/catalog.dto.js';

const isUnique = (e: unknown) => e instanceof QueryFailedError && (e as any).code === '23505';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(CatalogCategory) private readonly categories: Repository<CatalogCategory>,
    @InjectRepository(CatalogItem) private readonly items: Repository<CatalogItem>,
    @InjectRepository(CatalogSource) private readonly sources: Repository<CatalogSource>,
    @InjectRepository(Redirect) private readonly redirects: Repository<Redirect>,
    private readonly audit: AuditService,
  ) {}

  private async save<T extends object>(repo: Repository<T>, entity: T) {
    try {
      return await repo.save(entity);
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A record with this slug/code already exists');
      throw e;
    }
  }

  // ---------- categories ----------
  async listCategories(includeUnpublished: boolean) {
    const rows: Record<string, any>[] = await this.categories.query(
      `SELECT c.*, (SELECT count(*)::int FROM catalog_items i WHERE i.category_id = c.id ${includeUnpublished ? '' : 'AND i.is_published'}) AS item_count
       FROM catalog_categories c ${includeUnpublished ? '' : 'WHERE c.is_published'}
       ORDER BY c.sort_order, c.title`,
    );
    return rows.map((r) => ({
      id: r.id, slug: r.slug, title: r.title, description: r.description, sortOrder: r.sort_order,
      isPublished: r.is_published, itemCount: r.item_count, createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  async getCategoryBySlug(slug: string, includeUnpublished = false) {
    const cat = await this.categories.findOneBy(includeUnpublished ? { slug } : { slug, isPublished: true });
    if (!cat) throw new NotFoundException('Category not found');
    const subgroups: { subgroup: string; count: number }[] = await this.items.query(
      `SELECT subgroup, count(*)::int AS count FROM catalog_items
       WHERE category_id = $1 AND subgroup IS NOT NULL ${includeUnpublished ? '' : 'AND is_published'}
       GROUP BY subgroup ORDER BY subgroup`,
      [cat.id],
    );
    return { ...cat, subgroups };
  }

  async createCategory(dto: CreateCategoryDto, actorId: string) {
    const cat = await this.save(this.categories, this.categories.create(dto));
    await this.audit.log({ actorId, action: 'catalog_category.create', entityType: 'catalog_item', entityId: cat.id, after: cat });
    return cat;
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actorId: string) {
    const before = await this.categories.findOneBy({ id });
    if (!before) throw new NotFoundException('Category not found');
    const after = await this.save(this.categories, this.categories.merge(before, dto));
    await this.audit.log({ actorId, action: 'catalog_category.update', entityType: 'catalog_item', entityId: id, after });
    return after;
  }

  // ---------- sources ----------
  listSources() {
    return this.sources.find({ order: { name: 'ASC' } });
  }

  createSource(dto: CreateSourceDto) {
    return this.save(this.sources, this.sources.create(dto));
  }

  async updateSource(id: string, dto: UpdateSourceDto) {
    const src = await this.sources.findOneBy({ id });
    if (!src) throw new NotFoundException('Source not found');
    return this.save(this.sources, this.sources.merge(src, dto));
  }

  // ---------- items (search / filter / sort / paginate) ----------
  async listItems(q: ItemQueryDto, includeUnpublished: boolean) {
    const qb = this.items
      .createQueryBuilder('i')
      .innerJoin(CatalogCategory, 'c', 'c.id = i.categoryId')
      .leftJoin(CatalogSource, 's', 's.id = i.sourceId')
      .addSelect(['c.slug', 'c.title', 's.code', 's.name'])
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize);

    if (!includeUnpublished) qb.andWhere('i.isPublished = true AND c.isPublished = true');
    if (q.category) qb.andWhere('c.slug = :category', { category: q.category });
    if (q.kind) qb.andWhere('i.kind = :kind', { kind: q.kind });
    if (q.subgroup) qb.andWhere('i.subgroup = :subgroup', { subgroup: q.subgroup });
    if (q.source) qb.andWhere('s.code = :source', { source: q.source });
    if (q.q) {
      qb.andWhere('(i.name ILIKE :q OR i.subgroup ILIKE :q OR i.ingredients::text ILIKE :q)', { q: `%${q.q}%` });
    }
    if (q.sort === '-name') qb.orderBy('i.name', 'DESC');
    else if (q.sort === 'newest') qb.orderBy('i.createdAt', 'DESC');
    else qb.orderBy('i.name', 'ASC');

    const { entities, raw } = await qb.getRawAndEntities();
    const total = await qb.getCount();
    const items = entities.map((e) => {
      const r = raw.find((x) => x.i_id === e.id);
      return {
        ...e,
        category: { slug: r?.c_slug, title: r?.c_title },
        source: r?.s_code ? { code: r.s_code, name: r.s_name } : null,
      };
    });
    return paged(items, total, q);
  }

  async getItem(id: string, includeUnpublished = false) {
    const item = await this.items.findOneBy(includeUnpublished ? { id } : { id, isPublished: true });
    if (!item) throw new NotFoundException('Catalog item not found');
    return this.decorate(item);
  }

  async getItemBySlug(categorySlug: string, slug: string) {
    const cat = await this.categories.findOneBy({ slug: categorySlug, isPublished: true });
    const item = cat && (await this.items.findOneBy({ categoryId: cat.id, slug, isPublished: true }));
    if (!item) throw new NotFoundException('Catalog item not found');
    return this.decorate(item);
  }

  private async decorate(item: CatalogItem) {
    const [category, source] = await Promise.all([
      this.categories.findOneBy({ id: item.categoryId }),
      item.sourceId ? this.sources.findOneBy({ id: item.sourceId }) : null,
    ]);
    return { ...item, category, source };
  }

  async createItem(dto: CreateItemDto, actorId: string) {
    const item = await this.save(this.items, this.items.create(dto));
    await this.audit.log({ actorId, action: 'catalog_item.create', entityType: 'catalog_item', entityId: item.id, after: item });
    return item;
  }

  async updateItem(id: string, dto: UpdateItemDto, actorId: string) {
    const before = await this.items.findOneBy({ id });
    if (!before) throw new NotFoundException('Catalog item not found');
    const snapshot = { ...before };
    const after = await this.save(this.items, this.items.merge(before, dto));

    // Keep stable URLs: when a slug or category changes, add a redirect from the old URL.
    if (dto.slug && dto.slug !== snapshot.slug || dto.categoryId && dto.categoryId !== snapshot.categoryId) {
      const [oldCat, newCat] = await Promise.all([
        this.categories.findOneBy({ id: snapshot.categoryId }),
        this.categories.findOneBy({ id: after.categoryId }),
      ]);
      if (oldCat && newCat) {
        await this.redirects.upsert(
          { fromPath: `/formulations/${oldCat.slug}/${snapshot.slug}/`, toPath: `/formulations/${newCat.slug}/${after.slug}/`, statusCode: 301 },
          ['fromPath'],
        );
      }
    }
    await this.audit.log({ actorId, action: 'catalog_item.update', entityType: 'catalog_item', entityId: id, before: snapshot, after });
    return after;
  }
}

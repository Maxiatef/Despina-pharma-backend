import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent } from '../../database/entities/index.js';
import { Roles } from '../../common/decorators/auth.decorators.js';
import { csvCell, paged } from '../../common/utils.js';
import { AuditQueryDto } from './dto/audit-query.dto.js';
import { AUDIT_ENTITY_TYPES, AUDIT_ROUTES } from './audit-routes.js';

/** Read-only: audit rows can be searched and exported, never edited or deleted through the API. */
@ApiTags('audit')
@ApiBearerAuth()
@Roles('admin')
@Controller('audit-events')
export class AuditController {
  constructor(@InjectRepository(AuditEvent) private readonly repo: Repository<AuditEvent>) {}

  private query(q: AuditQueryDto) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (q.entityType) qb.andWhere('a.entityType = :t', { t: q.entityType });
    if (q.entityId) qb.andWhere('a.entityId = :e', { e: q.entityId });
    if (q.actorId) qb.andWhere('a.actorId = :u', { u: q.actorId });
    if (q.visitors === 'true') qb.andWhere('a.actorId IS NULL');
    if (q.action) {
      if (q.action.endsWith('.')) qb.andWhere('a.action LIKE :a', { a: `${q.action}%` });
      else qb.andWhere('a.action = :a', { a: q.action });
    }
    if (q.projectId) qb.andWhere('(a.projectId = :p OR (a.entityType = :pt AND a.entityId = :p))', { p: q.projectId, pt: 'project' });
    if (q.inquiryId) qb.andWhere('(a.inquiryId = :i OR (a.entityType = :it AND a.entityId = :i))', { i: q.inquiryId, it: 'inquiry' });
    if (q.companyId) qb.andWhere('(a.companyId = :c OR (a.entityType = :ct AND a.entityId = :c))', { c: q.companyId, ct: 'company' });
    if (q.from) qb.andWhere('a.createdAt >= :from', { from: q.from });
    if (q.to) qb.andWhere('a.createdAt <= :to', { to: q.to });
    if (q.q) {
      qb.andWhere('(a.summary ILIKE :q OR a.action ILIKE :q OR a.entityLabel ILIKE :q OR a.actorEmail ILIKE :q OR a.path ILIKE :q)', { q: `%${q.q}%` });
    }
    return qb;
  }

  @Get()
  async list(@Query() q: AuditQueryDto) {
    // The list leaves out the heavy JSON columns; GET /audit-events/:id has everything.
    const qb = this.query(q)
      .select(['a.id', 'a.createdAt', 'a.actorId', 'a.actorEmail', 'a.actorRole', 'a.action', 'a.summary', 'a.entityType', 'a.entityId',
        'a.entityLabel', 'a.projectId', 'a.inquiryId', 'a.companyId', 'a.method', 'a.path', 'a.ip'])
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize);
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, q);
  }

  /** Options for the filters: record types, actions, and the people who appear in the log. */
  @Get('filters')
  async filters() {
    const [actions, actors] = await Promise.all([
      this.repo.query(`SELECT action, count(*)::int AS count FROM audit_events GROUP BY action ORDER BY action`),
      this.repo.query(`SELECT actor_id AS id, max(actor_email) AS email, max(actor_role) AS role, count(*)::int AS count
                       FROM audit_events WHERE actor_id IS NOT NULL GROUP BY actor_id ORDER BY max(actor_email)`),
    ]);
    const known = new Set(Object.values(AUDIT_ROUTES).map((r) => r.action));
    return {
      entityTypes: AUDIT_ENTITY_TYPES,
      actions: [...new Set([...known, ...actions.map((a: { action: string }) => a.action)])].sort(),
      actionCounts: Object.fromEntries(actions.map((a: { action: string; count: number }) => [a.action, a.count])),
      actors,
    };
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  async export(@Query() q: AuditQueryDto) {
    const rows = await this.query(q).take(20_000).getMany();
    const header = ['time_utc', 'user', 'role', 'action', 'summary', 'record_type', 'record', 'record_id', 'changes', 'ip', 'method', 'path'];
    const lines = rows.map((r) => {
      const changes = ((r.details?.changes as { field: string; from: unknown; to: unknown }[] | undefined) ?? [])
        .map((c) => `${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('; ');
      return [r.createdAt.toISOString(), r.actorEmail ?? 'website visitor', r.actorRole, r.action, r.summary, r.entityType, r.entityLabel, r.entityId,
        changes, r.ip, r.method, r.path].map(csvCell).join(',');
    });
    return '﻿' + [header.join(','), ...lines].join('\r\n');
  }

  @Get(':id')
  async one(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.repo.findOneBy({ id });
    if (!row) throw new NotFoundException('Audit entry not found');
    return row;
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent } from '../../database/entities/index.js';
import { Roles } from '../../common/decorators/auth.decorators.js';
import { paged } from '../../common/utils.js';
import { AuditQueryDto } from './dto/audit-query.dto.js';


@ApiTags('audit')
@ApiBearerAuth()
@Roles('admin')
@Controller('audit-events')
export class AuditController {
  constructor(@InjectRepository(AuditEvent) private readonly repo: Repository<AuditEvent>) {}

  @Get()
  async list(@Query() q: AuditQueryDto) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC').skip((q.page - 1) * q.pageSize).take(q.pageSize);
    if (q.entityType) qb.andWhere('a.entityType = :t', { t: q.entityType });
    if (q.entityId) qb.andWhere('a.entityId = :e', { e: q.entityId });
    if (q.actorId) qb.andWhere('a.actorId = :u', { u: q.actorId });
    if (q.q) qb.andWhere('a.action ILIKE :q', { q: `%${q.q}%` });
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, q);
  }
}

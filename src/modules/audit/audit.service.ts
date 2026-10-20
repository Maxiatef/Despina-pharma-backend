import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { AuditEvent } from '../../database/entities/index.js';
import { auditContext } from './audit-context.js';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  summary?: string;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditEvent) private readonly repo: Repository<AuditEvent>) {}

  /**
   * Inside an HTTP request the details are attached to the request's single audit row (AuditInterceptor writes it
   * once the action succeeded – nothing is logged for a failed action). Outside a request it is written directly.
   */
  async log(input: AuditInput, manager?: EntityManager) {
    const ctx = auditContext.getStore();
    if (ctx) {
      ctx.events.push({ actorId: input.actorId, action: input.action, entityType: input.entityType, entityId: input.entityId, before: input.before, after: input.after });
      return;
    }
    const repo = manager ? manager.getRepository(AuditEvent) : this.repo;
    await repo.save(repo.create({
      actorId: input.actorId ?? null,
      action: input.action,
      summary: input.summary ?? null,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ip: input.ip ?? null,
    }));
  }

  write(row: Partial<AuditEvent>) {
    return this.repo.save(this.repo.create(row));
  }

  /** Deletes activity-log rows older than AUDIT_RETENTION_DAYS (default 365; 0 = keep forever). */
  async purgeOld() {
    const days = Number(process.env.AUDIT_RETENTION_DAYS ?? 365);
    if (!Number.isFinite(days) || days <= 0) return 0;
    const res = await this.repo.createQueryBuilder().delete().where(`created_at < now() - make_interval(days => :days)`, { days: Math.floor(days) }).execute();
    return res.affected ?? 0;
  }
}

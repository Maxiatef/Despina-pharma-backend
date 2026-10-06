import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditEvent } from '../../database/entities/index.js';
import type { AuditEntity } from '../../common/enums.js';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: AuditEntity;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditEvent) private readonly repo: Repository<AuditEvent>) {}

  async log(input: AuditInput, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(AuditEvent) : this.repo;
    await repo.save(repo.create({
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ip: input.ip ?? null,
    }));
  }
}

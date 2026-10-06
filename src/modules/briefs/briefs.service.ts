import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Brief, BriefVersion } from '../../database/entities/index.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { CreateBriefDto } from './dto/briefs.dto.js';

@Injectable()
export class BriefsService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: ProjectAccessService,
  ) {}
  async listBriefs(user: AuthUser, productId: string) {
    await this.access.product(user, productId);
    return this.ds.getRepository(Brief).find({ where: { projectProductId: productId }, order: { createdAt: 'ASC' } });
  }

  async createBrief(user: AuthUser, productId: string, dto: CreateBriefDto) {
    await this.access.product(user, productId);
    return this.ds.transaction(async (m) => {
      const brief = await m.getRepository(Brief).save(m.getRepository(Brief).create({ projectProductId: productId, title: dto.title }));
      const version = await m.getRepository(BriefVersion).save(
        m.getRepository(BriefVersion).create({ briefId: brief.id, versionNo: 1, content: dto.content ?? {}, createdBy: user.id }),
      );
      return { ...brief, versions: [version] };
    });
  }

  async getBrief(user: AuthUser, briefId: string) {
    const { brief } = await this.access.brief(user, briefId);
    const versions = await this.ds.getRepository(BriefVersion).find({ where: { briefId }, order: { versionNo: 'DESC' } });
    return { ...brief, versions };
  }

  /** Briefs are never edited in place; every change is a new version. */
  async addBriefVersion(user: AuthUser, briefId: string, content: Record<string, unknown>) {
    await this.access.brief(user, briefId);
    const repo = this.ds.getRepository(BriefVersion);
    const last = await repo.findOne({ where: { briefId }, order: { versionNo: 'DESC' } });
    return repo.save(repo.create({ briefId, versionNo: (last?.versionNo ?? 0) + 1, content, createdBy: user.id }));
  }
}

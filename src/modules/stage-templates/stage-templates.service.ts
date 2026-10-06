import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StageTemplate } from '../../database/entities/index.js';
import { CreateStageTemplateDto, UpdateStageTemplateDto } from './dto/stage-template.dto.js';

/** Configurable project stage lists (Inquiry -> Discovery -> ... -> Completed). */
@Injectable()
export class StageTemplatesService {
  constructor(private readonly ds: DataSource) {}

  list() {
    return this.ds.getRepository(StageTemplate).find({ order: { name: 'ASC' } });
  }

  async create(dto: CreateStageTemplateDto) {
    return this.ds.transaction(async (m) => {
      if (dto.isDefault) await m.getRepository(StageTemplate).createQueryBuilder().update().set({ isDefault: false }).execute();
      return m.getRepository(StageTemplate).save(m.getRepository(StageTemplate).create(dto));
    });
  }

  async update(id: string, dto: UpdateStageTemplateDto) {
    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(StageTemplate);
      const t = await repo.findOneBy({ id });
      if (!t) throw new NotFoundException('Stage template not found');
      if (dto.isDefault) await repo.createQueryBuilder().update().set({ isDefault: false }).where('id <> :id', { id }).execute();
      return repo.save(repo.merge(t, dto));
    });
  }

  async get(id: string) {
    const t = await this.ds.getRepository(StageTemplate).findOneBy({ id });
    if (!t) throw new NotFoundException('Stage template not found');
    return t;
  }
}

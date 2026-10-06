import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Company, Contact, Project, ProjectStage, Quote, User } from '../../database/entities/index.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { UpdateProfileDto } from './dto/portal.dto.js';

/** The customer's own workspace home: profile, companies, projects and what needs their attention. */
@Injectable()
export class PortalService {
  constructor(private readonly ds: DataSource) {}

  async me(user: AuthUser) {
    const u = await this.ds.getRepository(User).findOne({ where: { id: user.id }, relations: { contact: true } });
    if (!u) throw new NotFoundException();
    const companies = user.companyIds.length ? await this.ds.getRepository(Company).findBy({ id: In(user.companyIds) }) : [];
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      mfaEnabled: u.mfaEnabled,
      contact: u.contact ?? null,
      companies: companies.map((c) => ({ id: c.id, name: c.name, website: c.website })),
    };
  }

  /** Update own contact details (name, phone, job title). Email changes go through Despina staff. */
  async updateProfile(user: AuthUser, dto: UpdateProfileDto) {
    const contacts = this.ds.getRepository(Contact);
    let contactId = user.contactId;
    if (!contactId) {
      const contact = await contacts.save(
        contacts.create({ email: user.email, firstName: dto.firstName ?? user.email.split('@')[0], companyId: user.companyIds[0] ?? null }),
      );
      contactId = contact.id;
      await this.ds.getRepository(User).update(user.id, { contactId });
    }
    await contacts.update(contactId, dto);
    return this.me({ ...user, contactId });
  }

  /** Projects with current stage and items waiting for the customer (sent quotes, shipped samples). */
  async overview(user: AuthUser) {
    if (!user.companyIds.length) return { projects: [], waitingForYou: { quotes: [], samples: [] } };
    const projects = await this.ds.getRepository(Project).find({
      where: { companyId: In(user.companyIds) },
      order: { updatedAt: 'DESC' },
    });
    const ids = projects.map((p) => p.id);
    const [stages, quotes, samples] = ids.length
      ? await Promise.all([
          this.ds.getRepository(ProjectStage).findBy({ id: In(projects.map((p) => p.currentStageId).filter(Boolean) as string[]) }),
          this.ds.getRepository(Quote).find({ where: { projectId: In(ids), status: 'sent' }, order: { updatedAt: 'DESC' } }),
          this.ds.query(
            `SELECT s.id, s.title, s.status, pp.project_id, pp.name AS product_name
             FROM samples s JOIN project_products pp ON pp.id = s.project_product_id
             WHERE pp.project_id = ANY($1) AND s.status = 'shipped' ORDER BY s.updated_at DESC`,
            [ids],
          ),
        ])
      : [[], [], []];
    return {
      projects: projects.map((p) => ({
        id: p.id, code: p.code, name: p.name, status: p.status, updatedAt: p.updatedAt,
        currentStage: stages.find((s) => s.id === p.currentStageId)?.name ?? null,
      })),
      waitingForYou: { quotes, samples },
    };
  }
}

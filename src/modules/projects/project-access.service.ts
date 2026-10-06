import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Brief, Project, ProjectProduct, Quote, Sample, SampleRevision } from '../../database/entities/index.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';

export const isStaff = (u: AuthUser) => u.role !== 'customer';

export function requireStaff(u: AuthUser) {
  if (!isStaff(u)) throw new ForbiddenException('Staff only');
}

/**
 * Staff see every project. Customers see only projects of companies they belong to.
 * Each resolver walks up to the project and checks access.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  async project(user: AuthUser, projectId: string) {
    const project = await this.ds.getRepository(Project).findOneBy({ id: projectId });
    if (!project) throw new NotFoundException('Project not found');
    if (!isStaff(user) && !user.companyIds.includes(project.companyId)) throw new ForbiddenException();
    return project;
  }

  async product(user: AuthUser, productId: string) {
    const product = await this.ds.getRepository(ProjectProduct).findOneBy({ id: productId });
    if (!product) throw new NotFoundException('Project product not found');
    const project = await this.project(user, product.projectId);
    return { product, project };
  }

  async brief(user: AuthUser, briefId: string) {
    const brief = await this.ds.getRepository(Brief).findOneBy({ id: briefId });
    if (!brief) throw new NotFoundException('Brief not found');
    return { brief, ...(await this.product(user, brief.projectProductId)) };
  }

  async sample(user: AuthUser, sampleId: string) {
    const sample = await this.ds.getRepository(Sample).findOneBy({ id: sampleId });
    if (!sample) throw new NotFoundException('Sample not found');
    return { sample, ...(await this.product(user, sample.projectProductId)) };
  }

  async sampleRevision(user: AuthUser, revisionId: string) {
    const revision = await this.ds.getRepository(SampleRevision).findOneBy({ id: revisionId });
    if (!revision) throw new NotFoundException('Sample revision not found');
    return { revision, ...(await this.sample(user, revision.sampleId)) };
  }

  async quote(user: AuthUser, quoteId: string) {
    const quote = await this.ds.getRepository(Quote).findOneBy({ id: quoteId });
    if (!quote) throw new NotFoundException('Quote not found');
    const project = await this.project(user, quote.projectId);
    if (!isStaff(user) && quote.status === 'draft') throw new NotFoundException('Quote not found');
    return { quote, project };
  }

  /** Active customer users of a company (for notifications). */
  async customerEmails(companyId: string): Promise<string[]> {
    const rows: { email: string }[] = await this.ds.query(
      `SELECT u.email FROM users u JOIN company_memberships cm ON cm.user_id = u.id
       WHERE cm.company_id = $1 AND u.is_active AND u.role = 'customer'`,
      [companyId],
    );
    return rows.map((r) => r.email);
  }

  /** Project owner + assigned staff; falls back to the owner notification address. */
  async staffEmails(project: Project): Promise<string[]> {
    const rows: { email: string }[] = await this.ds.query(
      `SELECT DISTINCT u.email FROM users u
       WHERE u.is_active AND (u.id = $1 OR u.id IN (SELECT user_id FROM assignments WHERE project_id = $2 AND unassigned_at IS NULL))`,
      [project.ownerId, project.id],
    );
    return rows.length ? rows.map((r) => r.email) : [this.config.get<string>('OWNER_NOTIFICATION_EMAIL') ?? ''].filter(Boolean);
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company, CompanyMembership, Contact, Inquiry, Project, User } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import { PageQueryDto, paged } from '../../common/utils.js';
import type { MemberRole } from '../../common/enums.js';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto.js';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(CompanyMembership) private readonly memberships: Repository<CompanyMembership>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Inquiry) private readonly inquiries: Repository<Inquiry>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly audit: AuditService,
  ) {}

  async list(q: PageQueryDto) {
    const qb = this.companies.createQueryBuilder('c').orderBy('c.name', 'ASC').skip((q.page - 1) * q.pageSize).take(q.pageSize);
    if (q.q) qb.where('c.name ILIKE :q OR c.website ILIKE :q', { q: `%${q.q}%` });
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, q);
  }

  async get(id: string) {
    const company = await this.companies.findOneBy({ id });
    if (!company) throw new NotFoundException('Company not found');
    const [contacts, members, inquiries, projects] = await Promise.all([
      this.contacts.find({ where: { companyId: id }, order: { firstName: 'ASC' } }),
      this.memberships.find({ where: { companyId: id }, relations: { user: true } }),
      this.inquiries.find({ where: { companyId: id }, order: { createdAt: 'DESC' }, take: 50 }),
      this.projects.find({ where: { companyId: id }, order: { updatedAt: 'DESC' } }),
    ]);
    return {
      ...company,
      contacts,
      members: members.map((m) => ({
        id: m.id,
        memberRole: m.memberRole,
        user: m.user ? { id: m.user.id, email: m.user.email, role: m.user.role } : null,
      })),
      inquiries: inquiries.map((i) => ({ id: i.id, referenceNo: i.referenceNo, formType: i.formType, status: i.status, createdAt: i.createdAt })),
      projects,
    };
  }

  async create(dto: CreateCompanyDto, actorId: string) {
    const company = await this.companies.save(this.companies.create(dto));
    await this.audit.log({ actorId, action: 'company.create', entityType: 'company', entityId: company.id, after: company });
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto, actorId: string) {
    const before = await this.companies.findOneBy({ id });
    if (!before) throw new NotFoundException('Company not found');
    const after = await this.companies.save(this.companies.merge({ ...before }, dto));
    await this.audit.log({ actorId, action: 'company.update', entityType: 'company', entityId: id, before, after });
    return after;
  }

  /** Only companies without projects can be deleted; inquiries keep their data (company link is cleared). */
  async remove(id: string, actorId: string) {
    const company = await this.companies.findOneBy({ id });
    if (!company) throw new NotFoundException('Company not found');
    if (await this.projects.existsBy({ companyId: id })) throw new ConflictException('Company has projects and cannot be deleted');
    await this.companies.delete(id);
    await this.audit.log({ actorId, action: 'company.delete', entityType: 'company', entityId: id, before: company });
    return { ok: true };
  }

  async addMember(companyId: string, userId: string, memberRole: MemberRole = 'member') {
    if (!(await this.companies.existsBy({ id: companyId }))) throw new NotFoundException('Company not found');
    if (!(await this.users.existsBy({ id: userId }))) throw new NotFoundException('User not found');
    await this.memberships.upsert({ companyId, userId, memberRole }, ['userId', 'companyId']);
    return this.memberships.findOneByOrFail({ companyId, userId });
  }

  async removeMember(companyId: string, userId: string) {
    await this.memberships.delete({ companyId, userId });
    return { ok: true };
  }
}

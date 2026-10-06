import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company, CompanyMembership, User } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { EmailService } from '../email/email.service.js';
import { paged } from '../../common/utils.js';
import { InviteUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(CompanyMembership) private readonly memberships: Repository<CompanyMembership>,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly email: EmailService,
  ) {}

  async list(q: UserQueryDto) {
    const qb = this.users.createQueryBuilder('u').orderBy('u.email', 'ASC').skip((q.page - 1) * q.pageSize).take(q.pageSize);
    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.active) qb.andWhere('u.isActive = :active', { active: q.active === 'true' });
    if (q.q) qb.andWhere('u.email ILIKE :q', { q: `%${q.q}%` });
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, q);
  }

  /** Staff users that leads/tasks can be assigned to. */
  listStaff() {
    return this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.role'])
      .where("u.isActive = true AND u.role <> 'customer'")
      .orderBy('u.email', 'ASC')
      .getMany();
  }

  async get(id: string) {
    const user = await this.users.findOne({ where: { id }, relations: { contact: true, memberships: { company: true } } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Accounts are invite-only: the user is created without a password and receives a set-password link. */
  async invite(dto: InviteUserDto, actorId: string) {
    if (await this.auth.findUserByEmail(dto.email)) throw new ConflictException('A user with this email already exists');
    if (dto.role === 'customer' && !dto.companyId) throw new BadRequestException('Customers must be invited into a company');
    if (dto.companyId && !(await this.companies.existsBy({ id: dto.companyId }))) throw new BadRequestException('Company not found');

    const user = await this.users.save(
      this.users.create({ email: dto.email.toLowerCase(), role: dto.role, contactId: dto.contactId ?? null, isActive: true }),
    );
    if (dto.companyId) {
      await this.memberships.insert({ userId: user.id, companyId: dto.companyId, memberRole: dto.memberRole ?? 'member' });
    }
    const token = await this.auth.createSignedToken(user.id, 'invite', 72);
    await this.email.queue({ kind: 'invite', to: user.email, template: 'invite', data: { token } });
    await this.audit.log({ actorId, action: 'user.invite', entityType: 'user', entityId: user.id, after: { email: user.email, role: user.role } });
    // Token returned so staff can share the link manually until Resend is connected.
    return { user, inviteToken: token };
  }

  async resendInvite(id: string, actorId: string) {
    const user = await this.get(id);
    const token = await this.auth.createSignedToken(user.id, 'invite', 72);
    await this.email.queue({ kind: 'invite', to: user.email, template: 'invite', data: { token } });
    await this.audit.log({ actorId, action: 'user.invite_resent', entityType: 'user', entityId: id });
    return { inviteToken: token };
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    if (id === actorId && (dto.isActive === false || (dto.role && dto.role !== 'admin'))) {
      throw new ForbiddenException('You cannot deactivate or demote yourself');
    }
    const before = await this.users.findOneBy({ id });
    if (!before) throw new NotFoundException('User not found');
    await this.users.update(id, dto);
    if (dto.isActive === false || dto.role) await this.auth.logoutEverywhere(id);
    const after = await this.users.findOneByOrFail({ id });
    await this.audit.log({ actorId, action: 'user.update', entityType: 'user', entityId: id, before, after });
    return after;
  }

  /** Admin reset of a user's two-factor login (lost phone). */
  async resetMfa(id: string, actorId: string) {
    await this.users.update(id, { mfaEnabled: false, mfaSecret: null });
    await this.auth.logoutEverywhere(id);
    await this.audit.log({ actorId, action: 'user.mfa_reset', entityType: 'user', entityId: id });
    return { ok: true };
  }
}

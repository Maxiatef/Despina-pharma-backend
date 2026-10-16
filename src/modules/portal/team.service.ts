import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CompanyMembership, Contact, User } from '../../database/entities/index.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { EmailService } from '../email/email.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { InviteColleagueDto } from './dto/portal.dto.js';

/**
 * A customer company's main contact (member role "owner") manages their own colleagues:
 * invite them into the company's workspace, send the invitation again, or remove them.
 * Everyone in the company sees the company's projects; nobody can reach another company.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly email: EmailService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async ownerOf(user: AuthUser, companyId: string) {
    const m = await this.ds.getRepository(CompanyMembership).findOneBy({ userId: user.id, companyId });
    if (!m) throw new NotFoundException('Company not found');
    if (m.memberRole !== 'owner') throw new ForbiddenException('Only the main contact of the company can manage colleagues – ask Despina Pharma');
  }

  /** Companies of the signed-in customer with their people. */
  async list(user: AuthUser) {
    if (!user.companyIds.length) return { companies: [] };
    const rows: Record<string, any>[] = await this.ds.query(
      `SELECT cm.company_id, co.name AS company_name, cm.member_role, u.id AS user_id, u.email, u.is_active,
              (u.password_hash IS NULL) AS pending, c.first_name, c.last_name, cm.created_at
       FROM company_memberships cm JOIN companies co ON co.id = cm.company_id JOIN users u ON u.id = cm.user_id
       LEFT JOIN contacts c ON c.id = u.contact_id
       WHERE cm.company_id = ANY($1) AND u.role = 'customer' ORDER BY co.name, cm.created_at`, [user.companyIds]);
    const companies = new Map<string, { id: string; name: string; canManage: boolean; people: unknown[] }>();
    for (const r of rows) {
      const co = companies.get(r.company_id) ?? { id: r.company_id, name: r.company_name, canManage: false, people: [] as unknown[] };
      if (r.user_id === user.id && r.member_role === 'owner') co.canManage = true;
      co.people.push({
        id: r.user_id, email: r.email, name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, role: r.member_role,
        status: !r.is_active ? 'removed' : r.pending ? 'invited' : 'active', isYou: r.user_id === user.id,
      });
      companies.set(r.company_id, co);
    }
    return { companies: [...companies.values()].map((c) => ({ ...c, people: c.people.filter((p: any) => p.status !== 'removed') })) };
  }

  async invite(user: AuthUser, dto: InviteColleagueDto) {
    await this.ownerOf(user, dto.companyId);
    await this.rateLimit.hit(`team-invite:${user.id}`, 20, 86_400);
    const email = dto.email.trim().toLowerCase();
    if (await this.auth.findUserByEmail(email)) {
      throw new ConflictException('This e-mail address already has an account – ask Despina Pharma to add it to your company');
    }
    const [company] = await this.ds.query(`SELECT name FROM companies WHERE id = $1`, [dto.companyId]);
    const [me] = await this.ds.query(
      `SELECT c.first_name, c.last_name FROM users u LEFT JOIN contacts c ON c.id = u.contact_id WHERE u.id = $1`, [user.id]);
    const created = await this.ds.transaction(async (m) => {
      const contact = await m.getRepository(Contact).save(m.getRepository(Contact).create({
        email, firstName: dto.firstName.trim(), lastName: dto.lastName?.trim() || null, jobTitle: dto.jobTitle?.trim() || null, companyId: dto.companyId,
      }));
      const u = await m.getRepository(User).save(m.getRepository(User).create({ email, role: 'customer', contactId: contact.id, isActive: true }));
      await m.getRepository(CompanyMembership).insert({ userId: u.id, companyId: dto.companyId, memberRole: dto.role ?? 'member' });
      return u;
    });
    const job = await this.sendInvite(created.id, email, user, company?.name, me);
    await this.audit.log({ actorId: user.id, action: 'company.member_invite', entityType: 'user', entityId: created.id,
      after: { companyId: dto.companyId, email, memberRole: dto.role ?? 'member' } });
    return { id: created.id, email, emailStatus: job.status };
  }

  private async sendInvite(userId: string, to: string, by: AuthUser, companyName?: string, me?: { first_name?: string; last_name?: string }) {
    const token = await this.auth.createSignedToken(userId, 'invite', 72);
    const invitedBy = [me?.first_name, me?.last_name].filter(Boolean).join(' ') || by.email;
    return this.email.queue({ kind: 'invite', to, template: 'invite', data: { token, role: 'customer', invitedBy, companyName } });
  }

  /** The colleague belongs to a company the signed-in owner manages. */
  private async colleague(user: AuthUser, userId: string) {
    if (userId === user.id) throw new BadRequestException('You cannot change your own access here');
    const rows: { company_id: string; role: string; email: string; password_hash: string | null; is_active: boolean }[] = await this.ds.query(
      `SELECT cm.company_id, u.role, u.email, u.password_hash, u.is_active FROM company_memberships cm JOIN users u ON u.id = cm.user_id
       WHERE cm.user_id = $1 AND cm.company_id = ANY($2)`, [userId, user.companyIds]);
    const own: string[] = [];
    for (const r of rows) {
      const mine = await this.ds.getRepository(CompanyMembership).findOneBy({ userId: user.id, companyId: r.company_id });
      if (mine?.memberRole === 'owner') own.push(r.company_id);
    }
    if (!rows.length || !own.length || rows[0].role !== 'customer') throw new NotFoundException('Colleague not found');
    return { row: rows[0], companyIds: own };
  }

  async resend(user: AuthUser, userId: string) {
    const { row, companyIds } = await this.colleague(user, userId);
    if (row.password_hash || !row.is_active) throw new BadRequestException('This colleague has already set a password');
    await this.rateLimit.hit(`team-invite:${user.id}`, 20, 86_400);
    const [company] = await this.ds.query(`SELECT name FROM companies WHERE id = $1`, [companyIds[0]]);
    const [me] = await this.ds.query(
      `SELECT c.first_name, c.last_name FROM users u LEFT JOIN contacts c ON c.id = u.contact_id WHERE u.id = $1`, [user.id]);
    const job = await this.sendInvite(userId, row.email, user, company?.name, me);
    return { emailStatus: job.status };
  }

  /** Removes the colleague from the companies this owner manages; with no company left, the login is closed at once. */
  async remove(user: AuthUser, userId: string) {
    const { companyIds } = await this.colleague(user, userId);
    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM company_memberships WHERE user_id = $1 AND company_id = ANY($2)`, [userId, companyIds]);
      const [{ left }] = await m.query(`SELECT count(*)::int AS left FROM company_memberships WHERE user_id = $1`, [userId]);
      if (!left) {
        await m.query(`UPDATE users SET is_active = false WHERE id = $1`, [userId]);
        await m.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      }
    });
    await this.audit.log({ actorId: user.id, action: 'company.member_remove', entityType: 'user', entityId: userId, after: { companyIds } });
    return { ok: true };
  }
}

import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { generateSecret, generateURI, verify } from 'otplib';
import { MoreThan, Repository } from 'typeorm';
import { CompanyMembership, Session, User } from '../../database/entities/index.js';
import { STAFF_ROLES } from '../../common/enums.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { randomToken, sha256 } from '../../common/utils.js';
import { AuditService } from '../audit/audit.service.js';

type TokenPurpose = 'invite' | 'reset';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(CompanyMembership) private readonly memberships: Repository<CompanyMembership>,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private get sessionDays() {
    return Number(this.config.get('SESSION_TTL_DAYS') ?? 7);
  }

  hashPassword(password: string) {
    return bcrypt.hash(password, 12);
  }

  private findWithSecrets(where: { id?: string; email?: string }) {
    const qb = this.users.createQueryBuilder('u').addSelect(['u.passwordHash', 'u.mfaSecret']);
    if (where.id) qb.where('u.id = :id', { id: where.id });
    else qb.where('lower(u.email) = lower(:email)', { email: where.email });
    return qb.getOne();
  }

  async login(email: string, password: string, mfaCode: string | undefined, ip: string | null, userAgent?: string) {
    const user = await this.findWithSecrets({ email });
    const ok = user?.passwordHash && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');

    if (user.mfaEnabled) {
      if (!mfaCode) throw new UnauthorizedException({ message: 'MFA code required', mfaRequired: true });
      if (!(await this.checkTotp(user.mfaSecret!, mfaCode))) throw new UnauthorizedException('Invalid MFA code');
    }

    const token = randomToken();
    const session = await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        tokenHash: sha256(token),
        ip,
        userAgent: userAgent ?? null,
        expiresAt: new Date(Date.now() + this.sessionDays * 86_400_000),
      }),
    );
    await this.users.update(user.id, { lastLoginAt: new Date() });
    // Sign-ins are not written to the audit log (owner decision); sessions + last_login_at record them.

    const staffNeedsMfa =
      STAFF_ROLES.includes(user.role) && !user.mfaEnabled && this.config.get('REQUIRE_STAFF_MFA') !== 'false';
    return {
      token,
      expiresAt: session.expiresAt,
      mfaSetupRequired: staffNeedsMfa,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  async resolveToken(token: string): Promise<AuthUser | null> {
    const session = await this.sessions.findOne({
      where: { tokenHash: sha256(token), expiresAt: MoreThan(new Date()) },
    });
    if (!session) return null;
    const user = await this.users.findOne({ where: { id: session.userId, isActive: true } });
    if (!user) return null;
    const memberships = await this.memberships.find({ where: { userId: user.id } });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      contactId: user.contactId,
      sessionId: session.id,
      companyIds: memberships.map((m) => m.companyId),
    };
  }

  async logout(sessionId: string) {
    await this.sessions.delete(sessionId);
  }

  /** Active sessions of a user (token hashes are never returned). */
  listSessions(userId: string) {
    return this.sessions.find({
      where: { userId, expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.sessions.delete({ id: sessionId, userId });
    return { ok: true };
  }

  /** Delete expired sessions (called by the housekeeping job). */
  async purgeExpiredSessions() {
    await this.sessions.createQueryBuilder().delete().where('expires_at < now()').execute();
  }

  async logoutEverywhere(userId: string) {
    await this.sessions.delete({ userId });
  }

  // ---------- MFA (TOTP) ----------
  private async checkTotp(secret: string, code: string) {
    try {
      const result = await verify({ secret, token: code.replace(/\s/g, '') });
      return result.valid;
    } catch {
      return false;
    }
  }

  async mfaSetup(userId: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user) throw new UnauthorizedException();
    if (user.mfaEnabled) throw new BadRequestException('MFA is already enabled');
    const secret = generateSecret();
    await this.users.update(user.id, { mfaSecret: secret });
    const otpauthUrl = generateURI({ issuer: this.config.get('MFA_ISSUER') ?? 'Despina Pharma', label: user.email, secret });
    return { secret, otpauthUrl };
  }

  async mfaEnable(userId: string, code: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user?.mfaSecret) throw new BadRequestException('Run MFA setup first');
    if (!(await this.checkTotp(user.mfaSecret, code))) throw new BadRequestException('Invalid MFA code');
    await this.users.update(user.id, { mfaEnabled: true });
    await this.audit.log({ actorId: userId, action: 'auth.mfa_enabled', entityType: 'user', entityId: userId });
    return { mfaEnabled: true };
  }

  async mfaDisable(userId: string, code: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user?.mfaEnabled || !(await this.checkTotp(user.mfaSecret!, code))) throw new BadRequestException('Invalid MFA code');
    await this.users.update(user.id, { mfaEnabled: false, mfaSecret: null });
    await this.audit.log({ actorId: userId, action: 'auth.mfa_disabled', entityType: 'user', entityId: userId });
    return { mfaEnabled: false };
  }

  // ---------- Signed invite / reset tokens ----------
  // The token embeds a fingerprint of the current password hash, so it stops
  // working as soon as the password is set (single use).
  private secret() {
    const s = this.config.get<string>('APP_SECRET');
    if (!s || s.length < 32) throw new Error('APP_SECRET must be set (32+ characters)');
    return s;
  }

  async createSignedToken(userId: string, purpose: TokenPurpose, ttlHours: number) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user) throw new BadRequestException('User not found');
    const exp = Date.now() + ttlHours * 3_600_000;
    const body = `${purpose}.${user.id}.${exp}`;
    const sig = createHmac('sha256', this.secret()).update(`${body}.${user.passwordHash ?? ''}`).digest('base64url');
    return Buffer.from(`${body}.${sig}`).toString('base64url');
  }

  private async readSignedToken(token: string, purpose: TokenPurpose) {
    const [p, userId, exp, sig] = Buffer.from(token, 'base64url').toString().split('.');
    if (p !== purpose || !userId || Number(exp) < Date.now()) throw new BadRequestException('Invalid or expired link');
    const user = await this.findWithSecrets({ id: userId });
    if (!user) throw new BadRequestException('Invalid or expired link');
    const expected = createHmac('sha256', this.secret())
      .update(`${p}.${userId}.${exp}.${user.passwordHash ?? ''}`)
      .digest('base64url');
    const a = Buffer.from(expected);
    const b = Buffer.from(sig ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BadRequestException('Invalid or expired link');
    return user;
  }

  async setPasswordWithToken(token: string, purpose: TokenPurpose, password: string) {
    const user = await this.readSignedToken(token, purpose);
    await this.users.update(user.id, { passwordHash: await this.hashPassword(password), isActive: true });
    await this.logoutEverywhere(user.id);
    await this.audit.log({ actorId: user.id, action: `auth.${purpose}_password_set`, entityType: 'user', entityId: user.id });
    return { ok: true };
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user?.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.users.update(user.id, { passwordHash: await this.hashPassword(next) });
    await this.audit.log({ actorId: userId, action: 'auth.password_changed', entityType: 'user', entityId: userId });
    return { ok: true };
  }

  findUserByEmail(email: string) {
    return this.users.createQueryBuilder('u').where('lower(u.email) = lower(:email)', { email }).getOne();
  }
}

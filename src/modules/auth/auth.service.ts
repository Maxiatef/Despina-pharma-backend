import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { generateSecret, generateURI, verify } from 'otplib';
import { MoreThan, Repository } from 'typeorm';
import { CompanyMembership, Session, User } from '../../database/entities/index.js';
import { STAFF_ROLES } from '../../common/enums.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { randomToken, sha256 } from '../../common/utils.js';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { openSecret, sealSecret } from '../../common/secret-box.js';

type TokenPurpose = 'invite' | 'reset';

/** Same cost as real hashes; compared when the e-mail is unknown so login timing does not reveal accounts. */
const DUMMY_HASH = '$2b$12$IO.ECWMaP2HQFJ2Xh350FOicM7PFp9A3s7cAbikWVWATwPzzBrIjW';

/** Wrong 2FA codes allowed per account in 15 minutes (on top of the login limit). */
const MFA_FAIL_LIMIT = 5;
const MFA_FAIL_WINDOW = 900;
const BACKUP_CODE_COUNT = 10;
/** Backup code: 10 characters without look-alikes (0/O, 1/I/L), shown as xxxxx-xxxxx. */
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const normalizeBackup = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(CompanyMembership) private readonly memberships: Repository<CompanyMembership>,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Staff must use two-factor login unless REQUIRE_STAFF_MFA=false (local testing only). */
  get staffMfaRequired() {
    return this.config.get('REQUIRE_STAFF_MFA') !== 'false';
  }

  private get sessionDays() {
    return Number(this.config.get('SESSION_TTL_DAYS') ?? 7);
  }

  hashPassword(password: string) {
    return bcrypt.hash(password, 12);
  }

  private findWithSecrets(where: { id?: string; email?: string }) {
    const qb = this.users.createQueryBuilder('u').addSelect(['u.passwordHash', 'u.mfaSecret', 'u.mfaBackupCodes']);
    if (where.id) qb.where('u.id = :id', { id: where.id });
    else qb.where('lower(u.email) = lower(:email)', { email: where.email });
    return qb.getOne();
  }

  async login(email: string, password: string, mfaCode: string | undefined, ip: string | null, userAgent?: string) {
    const user = await this.findWithSecrets({ email });
    // Unknown e-mails are compared against a dummy hash so both cases take the same time (no account guessing by timing).
    const ok = (await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH)) && !!user?.passwordHash && user.isActive;
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');

    let usedBackupCode = false;
    if (user.mfaEnabled) {
      if (!mfaCode) throw new UnauthorizedException({ message: 'MFA code required', mfaRequired: true });
      const result = await this.verifySecondFactor(user, mfaCode, true);
      if (!result) throw new UnauthorizedException('Invalid MFA code');
      usedBackupCode = result === 'backup';
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

    const staffNeedsMfa = STAFF_ROLES.includes(user.role) && !user.mfaEnabled && this.staffMfaRequired;
    return {
      token,
      expiresAt: session.expiresAt,
      mfaSetupRequired: staffNeedsMfa,
      ...(usedBackupCode ? { backupCodesLeft: Math.max((user.mfaBackupCodes?.length ?? 1) - 1, 0) } : {}),
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
      mfaPending: STAFF_ROLES.includes(user.role) && !user.mfaEnabled && this.staffMfaRequired,
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

  // ---------- MFA (TOTP + one-time backup codes) ----------
  private async checkTotp(stored: string, code: string) {
    try {
      // One 30-second step either side: a code typed just as it changes, or a phone clock slightly off, still works.
      const result = await verify({ secret: openSecret(stored), token: code.replace(/\s/g, ''), epochTolerance: 30 });
      return result.valid;
    } catch {
      return false;
    }
  }

  /**
   * Checks a 6-digit app code, or (when allowed) a one-time backup code, which is then used up.
   * Wrong codes have their own limit per account, so a stolen password alone cannot be used to guess codes.
   */
  private async verifySecondFactor(user: User, code: string, allowBackup: boolean): Promise<'totp' | 'backup' | null> {
    const failKey = `mfa-fail:${user.id}`;
    if ((await this.rateLimit.peek(failKey, MFA_FAIL_WINDOW)) >= MFA_FAIL_LIMIT) {
      throw new HttpException('Too many wrong codes. Please wait 15 minutes and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const digits = code.replace(/\s/g, '');
    if (user.mfaSecret && /^\d{6}$/.test(digits) && (await this.checkTotp(user.mfaSecret, digits))) return 'totp';
    if (allowBackup && normalizeBackup(code).length === 10) {
      const hash = sha256(normalizeBackup(code));
      // Atomic: a backup code works once, even with two logins at the same moment.
      const used: { id: string }[] = await this.users.query(
        `UPDATE users SET mfa_backup_codes = mfa_backup_codes - $2::text WHERE id = $1 AND mfa_backup_codes ? $2::text RETURNING id`,
        [user.id, hash],
      ).then((r: unknown) => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as { id: string }[]);
      if (used.length) {
        await this.audit.log({ actorId: user.id, action: 'auth.mfa_backup_code_used', entityType: 'user', entityId: user.id });
        return 'backup';
      }
    }
    await this.rateLimit.record(failKey, MFA_FAIL_WINDOW);
    return null;
  }

  private newBackupCodes() {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => {
      const raw = Array.from({ length: 10 }, () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]).join('');
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    return { codes, hashes: codes.map((c) => sha256(normalizeBackup(c))) };
  }

  async mfaStatus(userId: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user) throw new UnauthorizedException();
    return {
      enabled: user.mfaEnabled,
      backupCodesLeft: user.mfaEnabled ? user.mfaBackupCodes?.length ?? 0 : 0,
      required: STAFF_ROLES.includes(user.role) && this.staffMfaRequired,
    };
  }

  async mfaSetup(userId: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user) throw new UnauthorizedException();
    if (user.mfaEnabled) throw new BadRequestException('MFA is already enabled');
    const secret = generateSecret();
    // Stored encrypted; the plain key is only shown here, once, to put into the app.
    await this.users.update(user.id, { mfaSecret: sealSecret(secret) });
    const otpauthUrl = generateURI({ issuer: this.config.get('MFA_ISSUER') ?? 'Despina Pharma', label: user.email, secret });
    return { secret, otpauthUrl };
  }

  /** Turns 2FA on and returns 10 backup codes (shown once; only their hashes are kept). */
  async mfaEnable(userId: string, code: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user?.mfaSecret) throw new BadRequestException('Run MFA setup first');
    if (user.mfaEnabled) throw new BadRequestException('MFA is already enabled');
    if (!(await this.verifySecondFactor(user, code, false))) throw new BadRequestException('Invalid MFA code');
    const { codes, hashes } = this.newBackupCodes();
    await this.users.update(user.id, { mfaEnabled: true, mfaBackupCodes: hashes });
    await this.audit.log({ actorId: userId, action: 'auth.mfa_enabled', entityType: 'user', entityId: userId });
    return { mfaEnabled: true, backupCodes: codes };
  }

  /** A new set of backup codes (the old ones stop working). Needs a current app code. */
  async mfaNewBackupCodes(userId: string, code: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user?.mfaEnabled || !(await this.verifySecondFactor(user, code, false))) throw new BadRequestException('Invalid MFA code');
    const { codes, hashes } = this.newBackupCodes();
    await this.users.update(user.id, { mfaBackupCodes: hashes });
    await this.audit.log({ actorId: userId, action: 'auth.mfa_backup_codes_renewed', entityType: 'user', entityId: userId });
    return { backupCodes: codes };
  }

  async mfaDisable(userId: string, code: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (user && STAFF_ROLES.includes(user.role) && this.staffMfaRequired) {
      throw new BadRequestException('Team accounts must keep two-factor login on. If you changed phones, ask an admin to reset it.');
    }
    if (!user?.mfaEnabled || !(await this.verifySecondFactor(user, code, false))) throw new BadRequestException('Invalid MFA code');
    await this.users.update(user.id, { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: null });
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

  async changePassword(userId: string, current: string, next: string, keepSessionId?: string) {
    const user = await this.findWithSecrets({ id: userId });
    if (!user?.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.users.update(user.id, { passwordHash: await this.hashPassword(next) });
    // Sign out every other device; the session that changed the password stays signed in.
    const others = this.sessions.createQueryBuilder().delete().where('user_id = :userId', { userId });
    if (keepSessionId) others.andWhere('id <> :keep', { keep: keepSessionId });
    const { affected } = await others.execute();
    await this.audit.log({ actorId: userId, action: 'auth.password_changed', after: { otherSessionsSignedOut: affected ?? 0 }, entityType: 'user', entityId: userId });
    return { ok: true };
  }

  findUserByEmail(email: string) {
    return this.users.createQueryBuilder('u').where('lower(u.email) = lower(:email)', { email }).getOne();
  }
}

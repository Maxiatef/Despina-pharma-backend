import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { USER_ROLES } from '../../common/enums.js';
import type { UserRole } from '../../common/enums.js';
import { CompanyMembership } from './company-membership.entity.js';
import { Contact } from './contact.entity.js';
import { Session } from './session.entity.js';

/** Login account (staff or invited customer). */
@Entity('users')
export class User extends BaseEntity {
  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @ManyToOne(() => Contact, (x) => x.users, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contact_id' })
  contact?: Relation<Contact> | null;

  @Column({ type: 'varchar', length: 254 })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash: string | null;

  @Column({ type: 'enum', enum: USER_ROLES, enumName: 'user_role', default: 'customer' })
  role: UserRole;

  @Column({ name: 'mfa_secret', type: 'varchar', length: 255, nullable: true, select: false })
  mfaSecret: string | null;

  @Column({ name: 'mfa_enabled', default: false })
  mfaEnabled: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @OneToMany(() => CompanyMembership, (x) => x.user)
  memberships?: Relation<CompanyMembership[]>;

  @OneToMany(() => Session, (x) => x.user)
  sessions?: Relation<Session[]>;
}

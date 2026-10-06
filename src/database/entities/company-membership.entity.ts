import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import type { Relation } from 'typeorm';
import { BaseEntity } from './base.entity.js';
import { MEMBER_ROLES } from '../../common/enums.js';
import type { MemberRole } from '../../common/enums.js';
import { Company } from './company.entity.js';
import { User } from './user.entity.js';

/** Which customer users belong to which company. */
@Entity('company_memberships')
export class CompanyMembership extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (x) => x.memberships, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company, (x) => x.memberships, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'company_id' })
  company?: Relation<Company>;

  @Column({ name: 'member_role', type: 'enum', enum: MEMBER_ROLES, enumName: 'member_role', default: 'member' })
  memberRole: MemberRole;
}

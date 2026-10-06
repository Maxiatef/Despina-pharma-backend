import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { STAFF_ROLES } from '../enums.js';
import type { UserRole } from '../enums.js';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Route needs no login (public website forms, catalog, webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Route is limited to these roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Route is limited to any Despina staff role (everyone except customers). */
export const StaffOnly = () => SetMetadata(ROLES_KEY, STAFF_ROLES);

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  contactId: string | null;
  sessionId: string;
  companyIds: string[];
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

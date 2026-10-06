import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../../common/decorators/auth.decorators.js';
import type { UserRole } from '../../common/enums.js';

export const SESSION_COOKIE = 'dp_session';

export function readToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
}

/** Global guard: every route needs a session unless marked @Public(); @Roles() narrows further. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);

    const token = readToken(req);
    const user = token ? await this.auth.resolveToken(token) : null;
    if (user) req.user = user;
    if (isPublic) return true;
    if (!user) throw new UnauthorizedException();

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}

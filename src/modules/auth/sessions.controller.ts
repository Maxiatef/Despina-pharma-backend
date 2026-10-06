import { Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { AuthService } from './auth.service.js';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/sessions')
export class SessionsController {
  constructor(private readonly auth: AuthService) {}

  /** GET /api/auth/sessions – my active logins */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id).then((rows) => rows.map((s) => ({ ...s, current: s.id === user.sessionId })));
  }

  /** DELETE /api/auth/sessions/:id – sign out one device */
  @Delete(':id')
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(user.id, id);
  }

  /** POST /api/auth/sessions/revoke-all – sign out everywhere */
  @Post('revoke-all')
  async revokeAll(@CurrentUser() user: AuthUser) {
    await this.auth.logoutEverywhere(user.id);
    return { ok: true };
  }
}

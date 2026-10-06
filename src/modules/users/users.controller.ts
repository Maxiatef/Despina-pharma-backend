import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { UsersService } from './users.service.js';
import { InviteUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto.js';

@ApiTags('users')
@ApiBearerAuth()
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() list(@Query() q: UserQueryDto) { return this.users.list(q); }

  /** Staff list for assignment dropdowns (any staff member). */
  @StaffOnly() @Get('staff') staff() { return this.users.listStaff(); }

  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.users.get(id); }
  @Post('invite') invite(@Body() dto: InviteUserDto, @CurrentUser() u: AuthUser) { return this.users.invite(dto, u.id); }
  @Post(':id/resend-invite') @HttpCode(200) resend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.users.resendInvite(id, u.id);
  }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() u: AuthUser) {
    return this.users.update(id, dto, u.id);
  }
  @Post(':id/reset-mfa') @HttpCode(200) resetMfa(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.users.resetMfa(id, u.id);
  }
}

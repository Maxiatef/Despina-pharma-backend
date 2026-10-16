import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { PortalService } from './portal.service.js';
import { TeamService } from './team.service.js';
import { InviteColleagueDto, UpdateProfileDto } from './dto/portal.dto.js';

/** Customer workspace home. Works for staff too (shows their own profile). */
@ApiTags('portal (customer)')
@ApiBearerAuth()
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService, private readonly team: TeamService) {}

  @Get('me') me(@CurrentUser() u: AuthUser) { return this.portal.me(u); }
  @Patch('me') update(@CurrentUser() u: AuthUser, @Body() dto: UpdateProfileDto) { return this.portal.updateProfile(u, dto); }
  @Get('overview') overview(@CurrentUser() u: AuthUser) { return this.portal.overview(u); }

  /** Colleagues in the customer's companies; the company's main contact (owner) can invite and remove them. */
  @Get('team') teamList(@CurrentUser() u: AuthUser) { return this.team.list(u); }
  @Post('team/invite') invite(@CurrentUser() u: AuthUser, @Body() dto: InviteColleagueDto) { return this.team.invite(u, dto); }
  @Post('team/:userId/resend') @HttpCode(200) resend(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) id: string) {
    return this.team.resend(u, id);
  }
  @Post('team/:userId/remove') @HttpCode(200) remove(@CurrentUser() u: AuthUser, @Param('userId', ParseUUIDPipe) id: string) {
    return this.team.remove(u, id);
  }
}

import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { PortalService } from './portal.service.js';
import { UpdateProfileDto } from './dto/portal.dto.js';

/** Customer workspace home. Works for staff too (shows their own profile). */
@ApiTags('portal (customer)')
@ApiBearerAuth()
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('me') me(@CurrentUser() u: AuthUser) { return this.portal.me(u); }
  @Patch('me') update(@CurrentUser() u: AuthUser, @Body() dto: UpdateProfileDto) { return this.portal.updateProfile(u, dto); }
  @Get('overview') overview(@CurrentUser() u: AuthUser) { return this.portal.overview(u); }
}

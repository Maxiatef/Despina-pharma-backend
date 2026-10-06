import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('dashboard (staff)')
@ApiBearerAuth()
@StaffOnly()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview') overview(@CurrentUser() u: AuthUser) { return this.dashboard.overview(u); }

  @Get('leads-per-week')
  leadsPerWeek(@Query('weeks', new DefaultValuePipe(12), ParseIntPipe) weeks: number) {
    return this.dashboard.leadsPerWeek(Math.min(Math.max(weeks, 1), 104));
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { ApprovalsService } from './approvals.service.js';
import { CreateApprovalDto } from './dto/approvals.dto.js';

const ID = new ParseUUIDPipe();

@ApiTags('approvals')
@ApiBearerAuth()
@Controller()
export class ApprovalsController {
  constructor(private readonly svc: ApprovalsService) {}

  @Get('projects/:id/approvals') approvals(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.svc.listApprovals(u, id); }
  @Post('projects/:id/approvals') approve(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: CreateApprovalDto) {
    return this.svc.approve(u, id, dto);
  }
}

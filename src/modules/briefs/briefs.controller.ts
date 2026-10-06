import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { BriefsService } from './briefs.service.js';
import { CreateBriefDto, BriefVersionDto } from './dto/briefs.dto.js';

const ID = new ParseUUIDPipe();

@ApiTags('briefs')
@ApiBearerAuth()
@Controller()
export class BriefsController {
  constructor(private readonly svc: BriefsService) {}

  @Get('project-products/:id/briefs') briefs(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.svc.listBriefs(u, id); }
  @Post('project-products/:id/briefs') createBrief(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: CreateBriefDto) {
    return this.svc.createBrief(u, id, dto);
  }
  @Get('briefs/:id') brief(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.svc.getBrief(u, id); }
  @Post('briefs/:id/versions') briefVersion(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: BriefVersionDto) {
    return this.svc.addBriefVersion(u, id, dto.content);
  }
}

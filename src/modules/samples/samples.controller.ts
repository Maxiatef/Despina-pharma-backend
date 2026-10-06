import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { SamplesService } from './samples.service.js';
import { CreateSampleDto, UpdateSampleDto, CreateSampleRevisionDto, UpdateSampleRevisionDto, CreateFeedbackDto } from './dto/samples.dto.js';

const ID = new ParseUUIDPipe();

@ApiTags('samples')
@ApiBearerAuth()
@Controller()
export class SamplesController {
  constructor(private readonly svc: SamplesService) {}

  @Get('project-products/:id/samples') samples(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.svc.listSamples(u, id); }
  @Post('project-products/:id/samples') createSample(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: CreateSampleDto) {
    return this.svc.createSample(u, id, dto);
  }
  @Get('samples/:id') sample(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.svc.getSample(u, id); }
  @StaffOnly() @Patch('samples/:id') updateSample(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: UpdateSampleDto) {
    return this.svc.updateSample(u, id, dto);
  }
  @StaffOnly() @Post('samples/:id/revisions') addRevision(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: CreateSampleRevisionDto) {
    return this.svc.addRevision(u, id, dto);
  }
  @StaffOnly() @Patch('sample-revisions/:id') updateRevision(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: UpdateSampleRevisionDto) {
    return this.svc.updateRevision(u, id, dto);
  }
  @Post('sample-revisions/:id/feedback') feedback(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: CreateFeedbackDto) {
    return this.svc.addFeedback(u, id, dto);
  }
}

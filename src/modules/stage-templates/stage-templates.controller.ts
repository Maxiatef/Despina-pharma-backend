import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles, StaffOnly } from '../../common/decorators/auth.decorators.js';
import { StageTemplatesService } from './stage-templates.service.js';
import { CreateStageTemplateDto, UpdateStageTemplateDto } from './dto/stage-template.dto.js';

const ID = new ParseUUIDPipe();

@ApiTags('stage templates')
@ApiBearerAuth()
@Controller('stage-templates')
export class StageTemplatesController {
  constructor(private readonly templates: StageTemplatesService) {}

  @StaffOnly() @Get() list() { return this.templates.list(); }
  @StaffOnly() @Get(':id') get(@Param('id', ID) id: string) { return this.templates.get(id); }
  @Roles('admin') @Post() create(@Body() dto: CreateStageTemplateDto) { return this.templates.create(dto); }
  @Roles('admin') @Patch(':id') update(@Param('id', ID) id: string, @Body() dto: UpdateStageTemplateDto) { return this.templates.update(id, dto); }
}

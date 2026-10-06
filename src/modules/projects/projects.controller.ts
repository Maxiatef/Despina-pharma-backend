import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { ProjectsService } from './projects.service.js';
import {
  CompleteStageDto, CreateProjectDto, CreateProjectProductDto, ProjectQueryDto, UpdateProjectDto, UpdateProjectProductDto,
} from './dto/project.dto.js';

const ID = new ParseUUIDPipe();

/** Customer workspace + staff project management. Customers only reach their own company's projects. */
@ApiTags('projects')
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // ---------- projects ----------
  @Get('projects') list(@CurrentUser() u: AuthUser, @Query() q: ProjectQueryDto) { return this.projects.list(u, q); }
  @StaffOnly() @Post('projects') create(@CurrentUser() u: AuthUser, @Body() dto: CreateProjectDto) { return this.projects.create(dto, u); }
  @Get('projects/:id') get(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.projects.get(u, id); }
  @StaffOnly() @Patch('projects/:id') update(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(u, id, dto);
  }
  @Get('projects/:id/timeline') timeline(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.projects.timeline(u, id); }
  @StaffOnly() @Post('projects/:id/stages/:stageId/complete')
  completeStage(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Param('stageId', ID) stageId: string, @Body() dto: CompleteStageDto) {
    return this.projects.completeStage(u, id, stageId, dto.note);
  }

  // ---------- products ----------
  @Post('projects/:id/products') addProduct(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: CreateProjectProductDto) {
    return this.projects.addProduct(u, id, dto);
  }
  @Patch('project-products/:id') updateProduct(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: UpdateProjectProductDto) {
    return this.projects.updateProduct(u, id, dto);
  }
  @Delete('project-products/:id') removeProduct(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.projects.removeProduct(u, id); }
}

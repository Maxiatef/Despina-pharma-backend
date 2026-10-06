import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { ProjectAccessService } from './project-access.service.js';
import { ProjectsController } from './projects.controller.js';

@Module({
  providers: [ProjectsService, ProjectAccessService],
  controllers: [ProjectsController],
  exports: [ProjectsService, ProjectAccessService],
})
export class ProjectsModule {}

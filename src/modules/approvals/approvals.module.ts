import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { ApprovalsService } from './approvals.service.js';
import { ApprovalsController } from './approvals.controller.js';

@Module({
  imports: [ProjectsModule],
  providers: [ApprovalsService],
  controllers: [ApprovalsController],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}

import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { BriefsService } from './briefs.service.js';
import { BriefsController } from './briefs.controller.js';

@Module({
  imports: [ProjectsModule],
  providers: [BriefsService],
  controllers: [BriefsController],
  exports: [BriefsService],
})
export class BriefsModule {}

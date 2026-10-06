import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { SamplesService } from './samples.service.js';
import { SamplesController } from './samples.controller.js';

@Module({
  imports: [ProjectsModule],
  providers: [SamplesService],
  controllers: [SamplesController],
  exports: [SamplesService],
})
export class SamplesModule {}

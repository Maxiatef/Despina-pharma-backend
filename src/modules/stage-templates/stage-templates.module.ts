import { Module } from '@nestjs/common';
import { StageTemplatesService } from './stage-templates.service.js';
import { StageTemplatesController } from './stage-templates.controller.js';

@Module({
  providers: [StageTemplatesService],
  controllers: [StageTemplatesController],
  exports: [StageTemplatesService],
})
export class StageTemplatesModule {}

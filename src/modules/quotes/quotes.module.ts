import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { QuotesService } from './quotes.service.js';
import { QuotesController } from './quotes.controller.js';

@Module({
  imports: [ProjectsModule],
  providers: [QuotesService],
  controllers: [QuotesController],
  exports: [QuotesService],
})
export class QuotesModule {}

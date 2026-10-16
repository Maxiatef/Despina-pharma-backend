import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';

@Module({
  imports: [ProjectsModule],
  providers: [RemindersService],
  controllers: [RemindersController],
  exports: [RemindersService],
})
export class RemindersModule {}

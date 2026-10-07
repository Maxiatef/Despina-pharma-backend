import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { CronController } from './cron.controller.js';

@Module({
  imports: [TasksModule],
  controllers: [CronController],
})
export class CronModule {}

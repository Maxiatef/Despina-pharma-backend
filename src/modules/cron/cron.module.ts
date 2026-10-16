import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { CronController } from './cron.controller.js';

@Module({
  imports: [TasksModule, RemindersModule],
  controllers: [CronController],
})
export class CronModule {}

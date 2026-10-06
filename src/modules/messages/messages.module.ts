import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { MessagesService } from './messages.service.js';
import { MessagesController } from './messages.controller.js';
import { InboundEmailController } from './inbound-email.controller.js';

@Module({
  imports: [ProjectsModule],
  providers: [MessagesService],
  controllers: [MessagesController, InboundEmailController],
  exports: [MessagesService],
})
export class MessagesModule {}

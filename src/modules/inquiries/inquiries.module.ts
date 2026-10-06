import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assignment, Inquiry, StatusEvent, User } from '../../database/entities/index.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { InquiriesService } from './inquiries.service.js';
import { InquiriesController, PublicInquiriesController } from './inquiries.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Inquiry, StatusEvent, Assignment, User]), ProjectsModule, MessagesModule],
  providers: [InquiriesService],
  controllers: [PublicInquiriesController, InquiriesController],
})
export class InquiriesModule {}

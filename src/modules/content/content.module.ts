import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Faq, Redirect, Service } from '../../database/entities/index.js';
import { ContentService } from './content.service.js';
import { AdminContentController, PublicContentController } from './content.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Service, Faq, Redirect])],
  providers: [ContentService],
  controllers: [PublicContentController, AdminContentController],
  exports: [ContentService],
})
export class ContentModule {}

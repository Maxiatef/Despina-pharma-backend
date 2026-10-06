import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentRecord, Contact } from '../../database/entities/index.js';
import { ConsentsService } from './consents.service.js';
import { ConsentsController, UnsubscribeController } from './consents.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([ConsentRecord, Contact])],
  providers: [ConsentsService],
  controllers: [ConsentsController, UnsubscribeController],
  exports: [ConsentsService],
})
export class ConsentsModule {}

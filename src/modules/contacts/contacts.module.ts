import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentRecord, Contact, Inquiry } from '../../database/entities/index.js';
import { StorageService } from '../documents/storage/storage.service.js';
import { ContactsService } from './contacts.service.js';
import { PersonalDataService } from './personal-data.service.js';
import { ContactsController } from './contacts.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Contact, Inquiry, ConsentRecord])],
  providers: [ContactsService, PersonalDataService, StorageService],
  controllers: [ContactsController],
  exports: [ContactsService],
})
export class ContactsModule {}

import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { DocumentsService } from './documents.service.js';
import { StorageService } from './storage/storage.service.js';
import { ScanService } from './storage/scan.service.js';
import { UploadsController } from './uploads.controller.js';
import { DocumentsController } from './documents.controller.js';

@Module({
  imports: [ProjectsModule],
  providers: [DocumentsService, StorageService, ScanService],
  controllers: [UploadsController, DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}

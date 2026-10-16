import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogCategory, CatalogItem, CatalogSource, Redirect } from '../../database/entities/index.js';
import { StorageService } from '../documents/storage/storage.service.js';
import { CatalogService } from './catalog.service.js';
import { AdminCatalogController, PublicCatalogController } from './catalog.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogCategory, CatalogItem, CatalogSource, Redirect])],
  providers: [CatalogService, StorageService],
  controllers: [PublicCatalogController, AdminCatalogController],
  exports: [CatalogService],
})
export class CatalogModule {}

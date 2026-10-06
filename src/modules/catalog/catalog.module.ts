import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogCategory, CatalogItem, CatalogSource, Redirect } from '../../database/entities/index.js';
import { CatalogService } from './catalog.service.js';
import { AdminCatalogController, PublicCatalogController } from './catalog.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogCategory, CatalogItem, CatalogSource, Redirect])],
  providers: [CatalogService],
  controllers: [PublicCatalogController, AdminCatalogController],
  exports: [CatalogService],
})
export class CatalogModule {}

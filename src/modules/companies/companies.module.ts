import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company, CompanyMembership, Contact, Inquiry, Project, User } from '../../database/entities/index.js';
import { CompaniesService } from './companies.service.js';
import { CompaniesController } from './companies.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Company, Contact, CompanyMembership, User, Inquiry, Project])],
  providers: [CompaniesService],
  controllers: [CompaniesController],
  exports: [CompaniesService],
})
export class CompaniesModule {}

import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { PageQueryDto } from '../../common/utils.js';
import { CompaniesService } from './companies.service.js';
import { CreateCompanyDto, MembershipDto, UpdateCompanyDto } from './dto/company.dto.js';

@ApiTags('companies')
@ApiBearerAuth()
@StaffOnly()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get() list(@Query() q: PageQueryDto) { return this.companies.list(q); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.companies.get(id); }
  @Post() create(@Body() dto: CreateCompanyDto, @CurrentUser() u: AuthUser) { return this.companies.create(dto, u.id); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto, @CurrentUser() u: AuthUser) {
    return this.companies.update(id, dto, u.id);
  }
  @Roles('admin') @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.companies.remove(id, u.id);
  }

  @Post(':id/members') addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MembershipDto) {
    return this.companies.addMember(id, dto.userId, dto.memberRole);
  }
  @Delete(':id/members/:userId') removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.companies.removeMember(id, userId);
  }
}

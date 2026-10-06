import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { ContactsService } from './contacts.service.js';
import { ContactQueryDto, CreateContactDto, UpdateContactDto } from './dto/contact.dto.js';

@ApiTags('contacts')
@ApiBearerAuth()
@StaffOnly()
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get() list(@Query() q: ContactQueryDto) { return this.contacts.list(q); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.contacts.get(id); }
  @Post() create(@Body() dto: CreateContactDto, @CurrentUser() u: AuthUser) { return this.contacts.create(dto, u.id); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto, @CurrentUser() u: AuthUser) {
    return this.contacts.update(id, dto, u.id);
  }
}

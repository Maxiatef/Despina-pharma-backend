import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { ContactsService } from './contacts.service.js';
import { PersonalDataService } from './personal-data.service.js';
import { ContactQueryDto, CreateContactDto, EraseContactDto, UpdateContactDto } from './dto/contact.dto.js';

@ApiTags('contacts')
@ApiBearerAuth()
@StaffOnly()
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService, private readonly personal: PersonalDataService) {}

  @Get() list(@Query() q: ContactQueryDto) { return this.contacts.list(q); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.contacts.get(id); }
  @Post() create(@Body() dto: CreateContactDto, @CurrentUser() u: AuthUser) { return this.contacts.create(dto, u.id); }
  /** The address bounced or was marked as spam: staff checked it, so e-mails may be sent again. */
  @Post(':id/clear-email-status') @HttpCode(200) clearEmailStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.clearEmailStatus(id);
  }
  /** Privacy request "send me my data": everything stored about this person as a JSON file (admin only). */
  @Roles('admin')
  @Get(':id/export')
  @Header('Content-Disposition', 'attachment; filename="personal-data.json"')
  export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.personal.export(id, u.id); }

  /** Privacy request "delete my data": removes the person's details, keeps the business records anonymous (admin only). */
  @Roles('admin')
  @Post(':id/erase') @HttpCode(200)
  erase(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EraseContactDto, @CurrentUser() u: AuthUser) {
    return this.personal.erase(id, dto.confirm, u.id);
  }

  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto, @CurrentUser() u: AuthUser) {
    return this.contacts.update(id, dto, u.id);
  }
}

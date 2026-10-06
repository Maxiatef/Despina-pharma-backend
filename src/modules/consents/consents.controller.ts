import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, Public, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { clientIp } from '../../common/utils.js';
import { ConsentsService } from './consents.service.js';
import { RecordConsentDto, UnsubscribeQueryDto } from './dto/consent.dto.js';

@ApiTags('consents')
@ApiBearerAuth()
@StaffOnly()
@Controller('contacts/:contactId/consents')
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get() history(@Param('contactId', ParseUUIDPipe) contactId: string) { return this.consents.history(contactId); }
  @Get('current') current(@Param('contactId', ParseUUIDPipe) contactId: string) { return this.consents.current(contactId); }

  /** Staff records a consent change the customer gave by phone/email. */
  @Post()
  record(@Param('contactId', ParseUUIDPipe) contactId: string, @Body() dto: RecordConsentDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.consents.record(contactId, dto.consentType, dto.granted, clientIp(req), u.id, dto.policyVersion);
  }

  @Get('unsubscribe-link') link(@Param('contactId', ParseUUIDPipe) contactId: string) {
    return { url: this.consents.unsubscribeLink(contactId) };
  }
}

@ApiTags('public: forms')
@Public()
@Controller('public/unsubscribe')
export class UnsubscribeController {
  constructor(private readonly consents: ConsentsService) {}

  /** GET /api/public/unsubscribe?c=<contactId>&s=<signature> – one-click marketing opt-out. */
  @Get()
  unsubscribe(@Query() q: UnsubscribeQueryDto, @Req() req: Request) {
    return this.consents.unsubscribe(q.c, q.s, clientIp(req));
  }
}

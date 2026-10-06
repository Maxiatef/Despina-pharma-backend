import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { MessagesService } from './messages.service.js';
import { CreateMessageDto } from './dto/messages.dto.js';

const ID = new ParseUUIDPipe();

@ApiTags('messages')
@ApiBearerAuth()
@Controller()
export class MessagesController {
  constructor(private readonly svc: MessagesService) {}

  @Get('projects/:id/messages') messages(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.svc.listProjectMessages(u, id); }
  @Post('projects/:id/messages') postMessage(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: CreateMessageDto) {
    return this.svc.postProjectMessage(u, id, dto.body);
  }
}

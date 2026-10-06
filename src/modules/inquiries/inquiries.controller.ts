import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, Public, Roles, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import type { FormType } from '../../common/enums.js';
import { clientIp } from '../../common/utils.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { CreateMessageDto } from '../messages/dto/messages.dto.js';
import { InquiriesService } from './inquiries.service.js';
import {
  AssignDto, ConvertToProjectDto, InquiryQueryDto, NoteDto, SubmitFixedInquiryDto, SubmitInquiryDto, UpdateStatusDto,
} from './dto/inquiry.dto.js';

/** Public website forms (no login needed). */
@ApiTags('public: forms')
@Public()
@Controller()
export class PublicInquiriesController {
  constructor(
    private readonly inquiries: InquiriesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async submit(dto: SubmitInquiryDto, req: Request, formType?: FormType) {
    const ip = clientIp(req);
    await this.rateLimit.hit(`inquiry:ip:${ip}`, Number(process.env.INQUIRY_RATE_LIMIT_PER_HOUR ?? 20), 3600);
    await this.rateLimit.hit(`inquiry:email:${dto.contact.email.toLowerCase()}`, 10, 3600);
    return this.inquiries.submit({ ...dto, formType: formType ?? dto.formType }, { ip, userAgent: req.headers['user-agent'] ?? null });
  }

  /** All six forms: contact, new_customer, new_product, sample_request, sample_feedback, service. */
  @Post('inquiries')
  @HttpCode(201)
  @ApiOkResponse({ description: '{ id, referenceNo, status, duplicate }' })
  create(@Body() dto: SubmitInquiryDto, @Req() req: Request) {
    return this.submit(dto, req);
  }

  /** New product / project brief form. */
  @Post('project-briefs')
  @HttpCode(201)
  projectBrief(@Body() dto: SubmitFixedInquiryDto, @Req() req: Request) {
    return this.submit(dto, req, 'new_product');
  }

  /** Sample request form. */
  @Post('sample-requests')
  @HttpCode(201)
  sampleRequest(@Body() dto: SubmitFixedInquiryDto, @Req() req: Request) {
    return this.submit(dto, req, 'sample_request');
  }
}

/** Internal lead dashboard. */
@ApiTags('leads (staff)')
@ApiBearerAuth()
@StaffOnly()
@Controller('inquiries')
export class InquiriesController {
  constructor(
    private readonly inquiries: InquiriesService,
    private readonly projects: ProjectsService,
    private readonly messagesService: MessagesService,
  ) {}

  @Get() list(@Query() q: InquiryQueryDto) { return this.inquiries.list(q); }
  @Get('board') board(@Query() q: InquiryQueryDto) { return this.inquiries.board(q); }
  @Get('summary') summary() { return this.inquiries.summary(); }

  @Roles('admin', 'sales')
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="inquiries.csv"')
  export(@Query() q: InquiryQueryDto) { return this.inquiries.exportCsv(q); }

  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.inquiries.get(id); }

  @Patch(':id/status')
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusDto, @CurrentUser() u: AuthUser) {
    return this.inquiries.changeStatus(id, dto.status, dto.note, u.id);
  }

  @Post(':id/notes') note(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto, @CurrentUser() u: AuthUser) {
    return this.inquiries.addNote(id, dto.note, u.id);
  }

  @Post(':id/assign') assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @CurrentUser() u: AuthUser) {
    return this.inquiries.assign(id, dto.userId, u.id);
  }

  @Delete(':id/assign') unassign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.inquiries.unassign(id, u.id);
  }

  @Get(':id/messages') messages(@Param('id', ParseUUIDPipe) id: string) { return this.messagesService.listInquiryMessages(id); }

  @Post(':id/messages') reply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateMessageDto, @CurrentUser() u: AuthUser) {
    return this.messagesService.postInquiryMessage(u, id, dto.body);
  }

  /** Convert a lead into a project without re-entering data. */
  @Roles('admin', 'sales')
  @Post(':id/convert')
  convert(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertToProjectDto, @CurrentUser() u: AuthUser) {
    return this.projects.convertFromInquiry(id, dto, u);
  }
}

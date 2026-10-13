import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Public, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { DocumentsService } from './documents.service.js';
import { UpdateDocumentDto, ScanDto, SignedQueryDto, RequestApprovalDto } from './dto/document.dto.js';

@ApiTags('documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(private readonly uploads: DocumentsService) {}

  @Get('projects/:id/documents') forProject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.listForProject(u, id);
  }

  @StaffOnly() @Get('inquiries/:id/documents') forInquiry(@Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.listForInquiry(id);
  }

  @Get('documents/:id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.uploads.get(u, id); }

  @StaffOnly() @Patch('documents/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto) {
    return this.uploads.update(u, id, dto);
  }

  @StaffOnly() @Post('documents/:id/request-approval') @HttpCode(200)
  requestApproval(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestApprovalDto) {
    return this.uploads.requestApproval(u, id, dto.note);
  }

  @StaffOnly() @Post('document-versions/:id/scan') @HttpCode(200)
  scan(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScanDto) {
    return this.uploads.setScanStatus(u, id, dto.scanStatus);
  }

  /** Returns a short-lived signed URL. */
  @Post('document-versions/:id/download-link') @HttpCode(200)
  link(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.uploads.downloadLink(u, id); }

  /** The signed URL itself. Always a download, never rendered inline from our origin. */
  @Public()
  @Get('files/:versionId')
  async file(@Param('versionId', ParseUUIDPipe) versionId: string, @Query() q: SignedQueryDto, @Res() res: Response) {
    const { version, stream } = await this.uploads.openSigned(versionId, q.exp, q.sig);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(version.originalFilename)}`);
    stream.pipe(res);
  }
}

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

  /** The signed URL itself. Downloads by default; with ?inline=1 safe types (images, PDF) open in the browser. */
  @Public()
  @Get('files/:versionId')
  async file(@Param('versionId', ParseUUIDPipe) versionId: string, @Query() q: SignedQueryDto, @Res() res: Response) {
    const { version, stream } = await this.uploads.openSigned(versionId, q.exp, q.sig);
    // The type comes from the file name, never from the uploader, so an SVG or HTML file can't be shown inline.
    const ext = version.originalFilename.toLowerCase().split('.').pop() ?? '';
    const viewType = q.inline === '1' ? VIEWABLE[ext] : undefined;
    res.setHeader('Content-Type', viewType ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The browser's PDF viewer doesn't work in a sandboxed page; PDFs still can't reach our site.
    res.setHeader('Content-Security-Policy', viewType === 'application/pdf' ? "default-src 'none'; object-src 'self'" : "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${viewType ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(version.originalFilename)}`);
    stream.pipe(res);
  }
}

const VIEWABLE: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
};

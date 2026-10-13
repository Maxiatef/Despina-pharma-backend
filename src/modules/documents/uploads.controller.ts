import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { clientIp } from '../../common/utils.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { DocumentsService } from './documents.service.js';
import { InitiateUploadDto, CompleteUploadDto } from './dto/document.dto.js';

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: DocumentsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** POST /api/uploads/initiate */
  @Public()
  @Post('initiate')
  async initiate(@Body() dto: InitiateUploadDto, @Req() req: Request & { user?: AuthUser }) {
    if (!req.user) await this.rateLimit.hit(`upload:${clientIp(req)}`, 30, 3600);
    return this.uploads.initiate(dto, req.user);
  }

  /** PUT /api/uploads/:id/content – raw file bytes as the request body. */
  @Public()
  @Put(':id/content')
  @ApiHeader({ name: 'X-Upload-Token', required: true })
  @ApiHeader({ name: 'X-Filename', required: true, description: 'URI-encoded original filename' })
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  content(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-upload-token') token: string,
    @Headers('x-filename') filename: string,
    @Headers('content-type') contentType: string,
    @Req() req: Request & { user?: AuthUser },
  ) {
    if (!filename) throw new BadRequestException('X-Filename header is required');
    let name: string;
    try {
      name = decodeURIComponent(filename);
    } catch {
      throw new BadRequestException('X-Filename must be URI-encoded');
    }
    return this.uploads.putContent(id, token, name, (contentType ?? '').split(';')[0].trim(), req.body as Buffer, req.user);
  }

  /** POST /api/uploads/complete */
  @Public()
  @Post('complete')
  @HttpCode(200)
  complete(@Body() dto: CompleteUploadDto) {
    return this.uploads.complete(dto.documentId, dto.token);
  }
}

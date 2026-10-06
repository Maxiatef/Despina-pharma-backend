import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { ContentService } from './content.service.js';
import {
  CreateFaqDto, CreateRedirectDto, CreateServiceDto, FaqQueryDto, ResolveRedirectDto, UpdateFaqDto, UpdateRedirectDto,
  UpdateServiceDto,
} from './dto/content.dto.js';

/** Public website reads: services, FAQs, redirect lookup. */
@ApiTags('public: content')
@Public()
@Controller('public')
export class PublicContentController {
  constructor(private readonly content: ContentService) {}

  @Get('services') services() { return this.content.listServices(false); }
  @Get('services/:slug') service(@Param('slug') slug: string) { return this.content.getServiceBySlug(slug); }
  @Get('faqs') faqs(@Query() q: FaqQueryDto) { return this.content.listFaqs(q, false); }
  @Get('redirects/resolve') resolve(@Query() q: ResolveRedirectDto) { return this.content.resolveRedirect(q.path); }
}

/** Admin CMS: services, FAQs, SEO redirects. */
@ApiTags('admin: content')
@ApiBearerAuth()
@Roles('admin', 'sales')
@Controller('admin')
export class AdminContentController {
  constructor(private readonly content: ContentService) {}

  @Get('services') services() { return this.content.listServices(true); }
  @Post('services') createService(@Body() dto: CreateServiceDto, @CurrentUser() u: AuthUser) { return this.content.createService(dto, u.id); }
  @Patch('services/:id') updateService(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto, @CurrentUser() u: AuthUser) {
    return this.content.updateService(id, dto, u.id);
  }

  @Get('faqs') faqs(@Query() q: FaqQueryDto) { return this.content.listFaqs(q, true); }
  @Post('faqs') createFaq(@Body() dto: CreateFaqDto, @CurrentUser() u: AuthUser) { return this.content.createFaq(dto, u.id); }
  @Patch('faqs/:id') updateFaq(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFaqDto, @CurrentUser() u: AuthUser) {
    return this.content.updateFaq(id, dto, u.id);
  }
  @Delete('faqs/:id') deleteFaq(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.content.deleteFaq(id, u.id); }

  @Get('redirects') redirects() { return this.content.listRedirects(); }
  @Post('redirects') createRedirect(@Body() dto: CreateRedirectDto) { return this.content.createRedirect(dto); }
  @Patch('redirects/:id') updateRedirect(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRedirectDto) {
    return this.content.updateRedirect(id, dto);
  }
  @Delete('redirects/:id') deleteRedirect(@Param('id', ParseUUIDPipe) id: string) { return this.content.deleteRedirect(id); }
}

import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { CatalogService } from './catalog.service.js';
import {
  CreateCategoryDto, CreateItemDto, CreateSourceDto, ItemQueryDto, UpdateCategoryDto, UpdateItemDto, UpdateSourceDto,
} from './dto/catalog.dto.js';

/** Public website catalog (published only): search, filter, sort, pagination. */
@ApiTags('public: catalog')
@Public()
@Controller('public/catalog')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories') categories() { return this.catalog.listCategories(false); }
  @Get('categories/:slug') category(@Param('slug') slug: string) { return this.catalog.getCategoryBySlug(slug); }
  @Get('categories/:category/items/:slug') itemBySlug(@Param('category') c: string, @Param('slug') s: string) {
    return this.catalog.getItemBySlug(c, s);
  }
  @Get('items') items(@Query() q: ItemQueryDto) { return this.catalog.listItems(q, false); }
  @Get('items/:id') item(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.getItem(id); }
  @Get('sources') sources() { return this.catalog.listSources(); }

  /** Edited product pages: the website applies these on top of its generated pages (name, text, image, SEO, unpublished). */
  @Get('changes') changes() { return this.catalog.changedItems(); }

  /** Product images uploaded in the admin (public, cached for a year: each upload gets a new file name). */
  @Get('images/:itemId/:file')
  async image(@Param('itemId', ParseUUIDPipe) itemId: string, @Param('file') file: string, @Res({ passthrough: true }) res: Response) {
    const { stream, contentType } = await this.catalog.readImage(itemId, file);
    res.set({ 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(stream);
  }
}

/** Admin CMS for the catalog. */
@ApiTags('admin: catalog')
@ApiBearerAuth()
@Roles('admin', 'sales')
@Controller('admin/catalog')
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories') categories() { return this.catalog.listCategories(true); }
  @Post('categories') createCategory(@Body() dto: CreateCategoryDto, @CurrentUser() u: AuthUser) { return this.catalog.createCategory(dto, u.id); }
  @Patch('categories/:id') updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() u: AuthUser) {
    return this.catalog.updateCategory(id, dto, u.id);
  }

  @Get('sources') sources() { return this.catalog.listSources(); }
  @Post('sources') createSource(@Body() dto: CreateSourceDto) { return this.catalog.createSource(dto); }
  @Patch('sources/:id') updateSource(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSourceDto) {
    return this.catalog.updateSource(id, dto);
  }

  @Get('items') items(@Query() q: ItemQueryDto) { return this.catalog.listItems(q, true); }
  @Get('items/:id') item(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.getItem(id, true); }
  @Post('items') createItem(@Body() dto: CreateItemDto, @CurrentUser() u: AuthUser) { return this.catalog.createItem(dto, u.id); }
  @Patch('items/:id') updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto, @CurrentUser() u: AuthUser) {
    return this.catalog.updateItem(id, dto, u.id);
  }
  /** PUT raw image bytes (PNG, JPEG or WebP, up to 5 MB); sets the item's imageUrl. */
  @Put('items/:id/image')
  uploadImage(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Headers('content-type') type: string, @CurrentUser() u: AuthUser) {
    if (!Buffer.isBuffer(req.body)) throw new BadRequestException('Send the image bytes as the request body');
    return this.catalog.setImage(id, req.body, (type ?? '').split(';')[0].trim(), u.id);
  }
}

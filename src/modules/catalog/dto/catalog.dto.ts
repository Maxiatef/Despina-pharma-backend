import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Matches, MaxLength, Min,
} from 'class-validator';
import { CATALOG_ITEM_KINDS } from '../../../common/enums.js';
import type { CatalogItemKind } from '../../../common/enums.js';
import { PageQueryDto } from '../../../common/utils.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateCategoryDto {
  @ApiProperty() @Matches(SLUG) @MaxLength(150) slug: string;
  @ApiProperty() @IsString() @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

export class CreateSourceDto {
  @ApiProperty() @Matches(SLUG) @MaxLength(50) code: string;
  @ApiProperty() @IsString() @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() website?: string;
}
export class UpdateSourceDto extends PartialType(CreateSourceDto) {}

export class CreateItemDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sourceId?: string;
  @ApiProperty() @Matches(SLUG) @MaxLength(200) slug: string;
  @ApiProperty() @IsString() @MaxLength(300) name: string;
  @ApiPropertyOptional({ enum: CATALOG_ITEM_KINDS }) @IsOptional() @IsIn(CATALOG_ITEM_KINDS) kind?: CatalogItemKind;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) subgroup?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() ingredients?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) seoTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) seoDescription?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;
}
export class UpdateItemDto extends PartialType(CreateItemDto) {}

export class ItemQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Category slug' }) @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional({ enum: CATALOG_ITEM_KINDS }) @IsOptional() @IsIn(CATALOG_ITEM_KINDS) kind?: CatalogItemKind;
  @ApiPropertyOptional() @IsOptional() @IsString() subgroup?: string;
  @ApiPropertyOptional({ description: 'Source code, e.g. rainshadow' }) @IsOptional() @IsString() source?: string;
  @ApiPropertyOptional({ enum: ['name', '-name', 'newest'] }) @IsOptional() @IsIn(['name', '-name', 'newest']) sort?: string;
}

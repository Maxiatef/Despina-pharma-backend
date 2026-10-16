import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PROJECT_STATUSES } from '../../../common/enums.js';
import type { ProjectStatus } from '../../../common/enums.js';
import { PageQueryDto } from '../../../common/utils.js';

// ---------- projects ----------
export class CreateProjectDto {
  @ApiProperty() @IsUUID() companyId: string;
  @ApiProperty() @IsString() @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() stageTemplateId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional({ enum: PROJECT_STATUSES }) @IsOptional() @IsIn(PROJECT_STATUSES) status?: ProjectStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ description: 'Required when the status changes to on_hold or cancelled' }) @IsOptional() @IsString() @MaxLength(2000) statusReason?: string;
  @ApiPropertyOptional({ description: 'Internal target date (YYYY-MM-DD, staff only); null clears it', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }) targetDate?: string | null;
  @ApiPropertyOptional({ description: 'Date promised to the customer (YYYY-MM-DD, shown in the portal); null clears it', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }) promisedDate?: string | null;
  @ApiPropertyOptional({ description: 'Why the promised date changed (shown on the project timeline)' }) @IsOptional() @IsString() @MaxLength(500) dateReason?: string;
}

export class ProjectQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PROJECT_STATUSES }) @IsOptional() @IsIn(PROJECT_STATUSES) status?: ProjectStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
}

export class CompleteStageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class StartProductStagesDto {
  @ApiPropertyOptional({ description: 'Defaults to the project template, then the default template' }) @IsOptional() @IsUUID() stageTemplateId?: string;
}

export const DEVELOPMENT_PATHS = ['custom_formulation', 'private_label', 'semi_custom', 'formula_transfer', 'packaging_only'] as const;
/** Detail fields a customer can mark "Not sure yet" instead of answering. */
export const PRODUCT_DETAIL_FIELDS = [
  'category', 'format', 'path', 'quantity', 'fillSize', 'includeIngredients', 'excludeIngredients', 'texture', 'fragrance',
  'color', 'finish', 'packaging', 'artwork', 'market', 'channels', 'launchDate', 'budget', 'references',
] as const;

/** Product-line brief (plan §7). Every field is optional; "notSure" lists the fields the customer has not decided yet. */
export class ProductDetailsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) category?: string;
  @ApiPropertyOptional({ description: 'e.g. lotion, serum, shampoo' }) @IsOptional() @IsString() @MaxLength(200) format?: string;
  @ApiPropertyOptional({ enum: DEVELOPMENT_PATHS }) @IsOptional() @IsIn(DEVELOPMENT_PATHS) path?: string;
  @ApiPropertyOptional({ description: 'Desired quantities, e.g. "5,000 units first run"' }) @IsOptional() @IsString() @MaxLength(500) quantity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) fillSize?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) includeIngredients?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) excludeIngredients?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) texture?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) fragrance?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) color?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) finish?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) packaging?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) artwork?: string;
  @ApiPropertyOptional({ description: 'Intended market / countries' }) @IsOptional() @IsString() @MaxLength(500) market?: string;
  @ApiPropertyOptional({ description: 'Sales channels' }) @IsOptional() @IsString() @MaxLength(500) channels?: string;
  @ApiPropertyOptional({ description: 'Target launch, free text or date' }) @IsOptional() @IsString() @MaxLength(100) launchDate?: string;
  @ApiPropertyOptional({ description: 'Optional budget' }) @IsOptional() @IsString() @MaxLength(200) budget?: string;
  @ApiPropertyOptional({ description: 'Reference products and links' }) @IsOptional() @IsString() @MaxLength(4000) references?: string;
  @ApiPropertyOptional({ enum: PRODUCT_DETAIL_FIELDS, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(PRODUCT_DETAIL_FIELDS.length) @IsIn(PRODUCT_DETAIL_FIELDS, { each: true }) notSure?: string[];
}

export class CreateProjectProductDto {
  @ApiPropertyOptional({ description: '"Add to project" from the catalog' }) @IsOptional() @IsUUID() catalogItemId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() serviceId?: string;
  @ApiPropertyOptional({ description: 'Defaults to the catalog item name' }) @IsOptional() @IsString() @MaxLength(300) name?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) targetQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional({ type: ProductDetailsDto }) @IsOptional() @ValidateNested() @Type(() => ProductDetailsDto) details?: ProductDetailsDto;
  @ApiPropertyOptional({ description: 'Internal target date (YYYY-MM-DD, staff only); null clears it', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }) targetDate?: string | null;
  @ApiPropertyOptional({ description: 'Date promised to the customer (YYYY-MM-DD, shown in the portal); null clears it', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true }) promisedDate?: string | null;
  @ApiPropertyOptional({ description: 'Why the promised date changed (shown on the project timeline)' }) @IsOptional() @IsString() @MaxLength(500) dateReason?: string;
}
export class UpdateProjectProductDto extends PartialType(CreateProjectProductDto) {}

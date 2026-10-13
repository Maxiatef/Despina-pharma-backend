import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
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

export class CreateProjectProductDto {
  @ApiPropertyOptional({ description: '"Add to project" from the catalog' }) @IsOptional() @IsUUID() catalogItemId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() serviceId?: string;
  @ApiPropertyOptional({ description: 'Defaults to the catalog item name' }) @IsOptional() @IsString() @MaxLength(300) name?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) targetQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
export class UpdateProjectProductDto extends PartialType(CreateProjectProductDto) {}

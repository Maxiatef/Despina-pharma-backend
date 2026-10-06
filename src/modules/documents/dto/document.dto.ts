import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { DOCUMENT_VISIBILITIES } from '../../../common/enums.js';
import type { DocumentVisibility } from '../../../common/enums.js';

export class InitiateUploadDto {
  @ApiProperty() @IsString() @MaxLength(300) filename: string;
  @ApiProperty() @IsString() @MaxLength(150) mimeType: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) sizeBytes: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title?: string;
  @ApiPropertyOptional({ description: 'Upload into a project (login required)' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Upload a new version of this document (login required)' }) @IsOptional() @IsUUID() documentId?: string;
  @ApiPropertyOptional({ enum: DOCUMENT_VISIBILITIES }) @IsOptional() @IsIn(DOCUMENT_VISIBILITIES) visibility?: DocumentVisibility;
}

export class CompleteUploadDto {
  @ApiProperty() @IsUUID() documentId: string;
  @ApiProperty() @IsString() token: string;
}

export class UpdateDocumentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title?: string;
  @ApiPropertyOptional({ enum: DOCUMENT_VISIBILITIES }) @IsOptional() @IsIn(DOCUMENT_VISIBILITIES) visibility?: DocumentVisibility;
}

export class ScanDto {
  @ApiProperty({ enum: ['clean', 'infected'] }) @IsIn(['clean', 'infected']) scanStatus: 'clean' | 'infected';
}

export class SignedQueryDto {
  @IsString() exp: string;
  @IsString() sig: string;
}

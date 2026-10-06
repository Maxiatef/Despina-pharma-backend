import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, Equals, IsArray, IsDefined, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { FORM_TYPES, INQUIRY_STATUSES } from '../../../common/enums.js';
import type { FormType, InquiryStatus } from '../../../common/enums.js';
import { PageQueryDto } from '../../../common/utils.js';

export class InquiryContactDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) firstName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) jobTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) country?: string;
}

export class InquiryCompanyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) website?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) industry?: string;
}

/** A product or service the visitor came from (pre-filled from the page). */
export class InquiryItemDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() catalogItemId?: string;
  @ApiPropertyOptional({ description: 'Alternative to catalogItemId: "category-slug/item-slug"' }) @IsOptional() @IsString() @MaxLength(400) catalogPath?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() serviceId?: string;
  @ApiPropertyOptional({ description: 'Alternative to serviceId' }) @IsOptional() @IsString() @MaxLength(150) serviceSlug?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class InquiryUploadRefDto {
  @ApiProperty() @IsUUID() documentId: string;
  @ApiProperty({ description: 'uploadToken returned by /uploads/initiate' }) @IsString() token: string;
}

export class InquiryConsentDto {
  @ApiProperty({ description: 'Must be true' }) @IsBoolean() @Equals(true) privacy: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marketing?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) policyVersion?: string;
}

export class SubmitInquiryDto {
  @ApiProperty({ enum: FORM_TYPES }) @IsIn(FORM_TYPES) formType: FormType;
  @ApiProperty({ description: 'Unique per submission (UUID made by the browser). Retries with the same key return the same inquiry.' })
  @IsString() @MinLength(8) @MaxLength(100) idempotencyKey: string;
  @ApiProperty({ type: InquiryContactDto }) @IsDefined() @ValidateNested() @Type(() => InquiryContactDto) contact: InquiryContactDto;
  @ApiPropertyOptional({ type: InquiryCompanyDto }) @IsOptional() @ValidateNested() @Type(() => InquiryCompanyDto) company?: InquiryCompanyDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) message?: string;
  @ApiPropertyOptional({ description: 'All other form answers' }) @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) sourcePage?: string;
  @ApiPropertyOptional({ type: [InquiryItemDto] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InquiryItemDto) items?: InquiryItemDto[];
  @ApiPropertyOptional({ type: [InquiryUploadRefDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => InquiryUploadRefDto) uploads?: InquiryUploadRefDto[];
  @ApiProperty({ type: InquiryConsentDto }) @IsDefined() @ValidateNested() @Type(() => InquiryConsentDto) consent: InquiryConsentDto;
  @ApiPropertyOptional({ description: 'Honeypot – must stay empty (hidden field)' }) @IsOptional() @IsString() hp?: string;
}

/** Same as SubmitInquiryDto but formType is fixed by the endpoint. */
export class SubmitFixedInquiryDto extends SubmitInquiryDto {
  @ApiPropertyOptional({ enum: FORM_TYPES, description: 'Ignored – set by the endpoint' }) @IsOptional() @IsIn(FORM_TYPES) declare formType: FormType;
}

export class InquiryQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: INQUIRY_STATUSES, isArray: true }) @IsOptional() @IsIn(INQUIRY_STATUSES, { each: true })
  status?: InquiryStatus | InquiryStatus[];
  @ApiPropertyOptional({ enum: FORM_TYPES }) @IsOptional() @IsIn(FORM_TYPES) formType?: FormType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigneeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) unassigned?: string;
  @ApiPropertyOptional({ description: 'Has an open task past its due date' }) @IsOptional() @IsIn(['true', 'false']) overdue?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'updated'] }) @IsOptional() @IsIn(['newest', 'oldest', 'updated']) sort?: string;
}

export class UpdateStatusDto {
  @ApiProperty({ enum: INQUIRY_STATUSES }) @IsIn(INQUIRY_STATUSES) status: InquiryStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) note?: string;
}

export class AssignDto {
  @ApiProperty() @IsUUID() userId: string;
}

export class NoteDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(5000) note: string;
}

export class ConvertToProjectDto {
  @ApiPropertyOptional({ description: 'Defaults to "<company> – <reference>"' }) @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional({ description: 'Defaults to the default stage template' }) @IsOptional() @IsUUID() stageTemplateId?: string;
  @ApiPropertyOptional({ enum: INQUIRY_STATUSES, description: 'Optionally move the lead to this status' }) @IsOptional() @IsIn(INQUIRY_STATUSES) setStatus?: InquiryStatus;
}

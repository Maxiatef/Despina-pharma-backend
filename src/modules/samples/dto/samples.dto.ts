import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { SAMPLE_STATUSES } from '../../../common/enums.js';
import type { SampleStatus } from '../../../common/enums.js';
export class CreateSampleDto {
  @ApiProperty() @IsString() @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inquiryId?: string;
}
export class UpdateSampleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) title?: string;
  @ApiPropertyOptional({ enum: SAMPLE_STATUSES }) @IsOptional() @IsIn(SAMPLE_STATUSES) status?: SampleStatus;
}
export class CreateSampleRevisionDto {
  /** Required: a revision must say what changed (no blank revisions). */
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @IsNotEmpty({ message: 'Describe what changed in this revision' }) @MaxLength(4000) description!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() shippedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) trackingNo?: string;
}
export class UpdateSampleRevisionDto extends PartialType(CreateSampleRevisionDto) {}
export const FEEDBACK_DECISIONS = ['approved_next_stage', 'request_changes'] as const;
/** Structured feedback on one sample revision (same questions as the website's sample review form). */
export class FeedbackDetailsDto {
  @ApiPropertyOptional({ enum: FEEDBACK_DECISIONS }) @IsOptional() @IsIn(FEEDBACK_DECISIONS) decision?: (typeof FEEDBACK_DECISIONS)[number];
  @ApiPropertyOptional({ description: 'Colour / appearance' }) @IsOptional() @IsString() @MaxLength(2000) appearance?: string;
  @ApiPropertyOptional({ description: 'Texture / viscosity' }) @IsOptional() @IsString() @MaxLength(2000) texture?: string;
  @ApiPropertyOptional({ description: 'Scent / fragrance' }) @IsOptional() @IsString() @MaxLength(2000) scent?: string;
  @ApiPropertyOptional({ description: 'Performance / application' }) @IsOptional() @IsString() @MaxLength(2000) performance?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) afterFeel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) packaging?: string;
  @ApiPropertyOptional({ description: 'Requested changes for the next revision' }) @IsOptional() @IsString() @MaxLength(4000) changes?: string;
  @ApiPropertyOptional({ description: 'Uploaded photos/files (documents of this project)' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) documentIds?: string[];
}
export class CreateFeedbackDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) comments?: string;
  @ApiPropertyOptional({ type: FeedbackDetailsDto }) @IsOptional() @ValidateNested() @Type(() => FeedbackDetailsDto) details?: FeedbackDetailsDto;
}
export class LinkFeedbackInquiryDto {
  @ApiProperty({ description: 'A "sample feedback" inquiry from the website form: its reference (DP-INQ-…) or ID' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @IsNotEmpty() @MaxLength(60) inquiry: string;
}

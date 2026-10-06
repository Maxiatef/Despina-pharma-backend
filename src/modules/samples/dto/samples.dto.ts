import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
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
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() shippedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) trackingNo?: string;
}
export class UpdateSampleRevisionDto extends PartialType(CreateSampleRevisionDto) {}
export class CreateFeedbackDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) comments?: string;
}

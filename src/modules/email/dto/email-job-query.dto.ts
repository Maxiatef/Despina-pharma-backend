import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EMAIL_JOB_STATUSES } from '../../../common/enums.js';
import { PageQueryDto } from '../../../common/utils.js';

export class EmailJobQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: EMAIL_JOB_STATUSES }) @IsOptional() @IsIn(EMAIL_JOB_STATUSES) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inquiryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'owner_notice, staff_notice, customer_ack, customer_notice, invite, …' }) @IsOptional() @IsString() @MaxLength(40) kind?: string;
}

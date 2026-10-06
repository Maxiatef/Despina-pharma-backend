import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { EMAIL_JOB_STATUSES } from '../../../common/enums.js';
import { PageQueryDto } from '../../../common/utils.js';

export class EmailJobQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: EMAIL_JOB_STATUSES }) @IsOptional() @IsIn(EMAIL_JOB_STATUSES) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inquiryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
}

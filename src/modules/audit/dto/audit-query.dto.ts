import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/utils.js';

export class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Record type, e.g. task, quote, inquiry (see /audit-events/filters)' }) @IsOptional() @IsString() @MaxLength(40) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
  @ApiPropertyOptional({ description: 'Exact action, e.g. task.complete; or a prefix ending with "." e.g. quote.' }) @IsOptional() @IsString() @MaxLength(100) action?: string;
  @ApiPropertyOptional({ description: 'Everything that happened on this project' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ description: 'Everything that happened on this lead' }) @IsOptional() @IsUUID() inquiryId?: string;
  @ApiPropertyOptional({ description: 'Everything that happened for this company' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ description: 'Only actions by website visitors (no account)' }) @IsOptional() @IsString() visitors?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

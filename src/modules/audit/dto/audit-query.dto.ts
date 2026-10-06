import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { AUDIT_ENTITIES } from '../../../common/enums.js';
import type { AuditEntity } from '../../../common/enums.js';
import { PageQueryDto } from '../../../common/utils.js';

export class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: AUDIT_ENTITIES }) @IsOptional() @IsIn(AUDIT_ENTITIES) entityType?: AuditEntity;
  @ApiPropertyOptional() @IsOptional() @IsUUID() entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
}

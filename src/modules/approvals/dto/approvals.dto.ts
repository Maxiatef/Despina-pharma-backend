import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { APPROVAL_TARGETS } from '../../../common/enums.js';
import type { ApprovalTarget } from '../../../common/enums.js';
export class CreateApprovalDto {
  @ApiProperty({ enum: APPROVAL_TARGETS }) @IsIn(APPROVAL_TARGETS) targetType: ApprovalTarget;
  @ApiProperty({ description: 'ID of the exact document/sample/quote/brief version being approved' }) @IsUUID() targetId: string;
  @ApiProperty({ description: 'Exact confirmation text the approver agreed to' }) @IsString() @MinLength(5) @MaxLength(5000) confirmationText: string;
}

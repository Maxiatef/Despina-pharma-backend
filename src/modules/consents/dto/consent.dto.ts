import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CONSENT_TYPES } from '../../../common/enums.js';
import type { ConsentType } from '../../../common/enums.js';

export class RecordConsentDto {
  @ApiProperty({ enum: CONSENT_TYPES }) @IsIn(CONSENT_TYPES) consentType: ConsentType;
  @ApiProperty() @IsBoolean() granted: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) policyVersion?: string;
}

export class UnsubscribeQueryDto {
  @ApiProperty() @IsUUID() c: string;
  @ApiProperty() @IsString() s: string;
}

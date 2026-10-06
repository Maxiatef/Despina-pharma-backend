import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';
import { MEMBER_ROLES } from '../../../common/enums.js';
import type { MemberRole } from '../../../common/enums.js';

export class CreateCompanyDto {
  @ApiProperty() @IsString() @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_protocol: false }) @MaxLength(300) website?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) industry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}

export class MembershipDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiPropertyOptional({ enum: MEMBER_ROLES }) @IsOptional() @IsIn(MEMBER_ROLES) memberRole?: MemberRole;
}

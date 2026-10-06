import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { MEMBER_ROLES, USER_ROLES } from '../../../common/enums.js';
import type { MemberRole, UserRole } from '../../../common/enums.js';
import { PageQueryDto } from '../../../common/utils.js';

export class InviteUserDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ enum: USER_ROLES }) @IsIn(USER_ROLES) role: UserRole;
  @ApiPropertyOptional() @IsOptional() @IsUUID() contactId?: string;
  @ApiPropertyOptional({ description: 'Required for customers: the company they join' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ enum: MEMBER_ROLES }) @IsOptional() @IsIn(MEMBER_ROLES) memberRole?: MemberRole;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: USER_ROLES }) @IsOptional() @IsIn(USER_ROLES) role?: UserRole;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() contactId?: string;
}

export class UserQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: USER_ROLES }) @IsOptional() @IsIn(USER_ROLES) role?: UserRole;
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) active?: string;
}

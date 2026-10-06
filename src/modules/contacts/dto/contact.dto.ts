import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/utils.js';

export class CreateContactDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiProperty() @IsString() @MaxLength(100) firstName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) jobTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) country?: string;
}

export class UpdateContactDto extends PartialType(CreateContactDto) {}

export class ContactQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
}

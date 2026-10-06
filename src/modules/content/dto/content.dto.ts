import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateServiceDto {
  @ApiProperty() @Matches(SLUG) @MaxLength(150) slug: string;
  @ApiProperty() @IsString() @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() summary?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() body?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;
}
export class UpdateServiceDto extends PartialType(CreateServiceDto) {}

export class CreateFaqDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() serviceId?: string;
  @ApiProperty() @IsString() question: string;
  @ApiProperty() @IsString() answer: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) topic?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;
}
export class UpdateFaqDto extends PartialType(CreateFaqDto) {}

export class FaqQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() topic?: string;
  @ApiPropertyOptional({ description: 'Service slug' }) @IsOptional() @IsString() service?: string;
}

export class CreateRedirectDto {
  @ApiProperty() @Matches(/^\//) @MaxLength(500) fromPath: string;
  @ApiProperty() @Matches(/^\/|^https?:\/\//) @MaxLength(500) toPath: string;
  @ApiPropertyOptional({ enum: [301, 302, 307, 308] }) @IsOptional() @Type(() => Number) @IsIn([301, 302, 307, 308]) statusCode?: number;
}
export class UpdateRedirectDto extends PartialType(CreateRedirectDto) {}

export class ResolveRedirectDto {
  @ApiProperty() @IsString() path: string;
}

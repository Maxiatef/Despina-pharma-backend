import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
export class CreateBriefDto {
  @ApiProperty() @IsString() @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() content?: Record<string, unknown>;
}
export class BriefVersionDto {
  @ApiProperty() @IsObject() content: Record<string, unknown>;
}

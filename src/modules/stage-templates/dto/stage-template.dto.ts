import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { USER_ROLES } from '../../../common/enums.js';
import type { UserRole } from '../../../common/enums.js';

export class StageDefinitionDto {
  @ApiProperty() @IsString() @MaxLength(150) name: string;
  @ApiPropertyOptional({ enum: USER_ROLES, description: 'Only this role (or admin) may complete the stage, e.g. quality release' })
  @IsOptional() @IsIn(USER_ROLES) requiresRole?: UserRole;
}

export class CreateStageTemplateDto {
  @ApiProperty() @IsString() @MaxLength(150) name: string;
  @ApiProperty({ type: [StageDefinitionDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => StageDefinitionDto) stages: StageDefinitionDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class UpdateStageTemplateDto extends PartialType(CreateStageTemplateDto) {}


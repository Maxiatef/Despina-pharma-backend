import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { TASK_PRIORITIES } from '../../../common/enums.js';
import type { TaskPriority } from '../../../common/enums.js';
import { PageQueryDto } from '../../../common/utils.js';

export class CreateTaskDto {
  @ApiProperty() @IsString() @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inquiryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigneeId?: string;
  @ApiPropertyOptional({ enum: TASK_PRIORITIES }) @IsOptional() @IsIn(TASK_PRIORITIES) priority?: TaskPriority;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;
}

export class UpdateTaskDto extends PartialType(CreateTaskDto) {}

export class TaskQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '"me" or a user id' }) @IsOptional() @IsString() assignee?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inquiryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ enum: ['open', 'done', 'overdue', 'all'] }) @IsOptional() @IsIn(['open', 'done', 'overdue', 'all']) state?: string;
}

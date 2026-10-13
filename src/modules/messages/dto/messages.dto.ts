import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class CreateMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(20_000) body: string;
}

/** Staff reply to a lead; askInfo = "we need more information" e-mail + lead moves to Waiting for customer. */
export class InquiryReplyDto extends CreateMessageDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() askInfo?: boolean;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
export class CreateMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(20_000) body: string;
}

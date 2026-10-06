import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { QUOTE_STATUSES } from '../../../common/enums.js';
import type { QuoteStatus } from '../../../common/enums.js';
export class QuoteLineDto {
  @ApiProperty() @IsString() @MaxLength(500) description: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectProductId?: string;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) quantity: number;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) unitPrice: number;
}
export class QuoteVersionDto {
  @ApiPropertyOptional({ default: 'USD' }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
  @ApiPropertyOptional({ description: 'PDF of the quote, if uploaded' }) @IsOptional() @IsUUID() documentVersionId?: string;
  @ApiProperty({ type: [QuoteLineDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines: QuoteLineDto[];
}
export class UpdateQuoteDto {
  @ApiProperty({ enum: QUOTE_STATUSES }) @IsIn(QUOTE_STATUSES) status: QuoteStatus;
}

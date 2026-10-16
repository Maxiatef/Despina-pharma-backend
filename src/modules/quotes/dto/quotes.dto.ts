import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { QUOTE_RESPONSES, QUOTE_STATUSES } from '../../../common/enums.js';
import type { QuoteResponseDecision, QuoteStatus } from '../../../common/enums.js';
export class QuoteLineDto {
  @ApiProperty() @IsString() @MaxLength(500) description: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() projectProductId?: string;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) quantity: number;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) unitPrice: number;
}
/** Free-text quote terms shown to the customer with the line items. */
export class QuoteTermsDto {
  @ApiPropertyOptional({ description: 'e.g. 50% deposit, 50% before dispatch' }) @IsOptional() @IsString() @MaxLength(2000) paymentSchedule?: string;
  @ApiPropertyOptional({ description: 'e.g. Prices exclude VAT 14%' }) @IsOptional() @IsString() @MaxLength(2000) taxes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) exclusions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) assumptions?: string;
  @ApiPropertyOptional({ description: 'Estimate only, not a commitment' }) @IsOptional() @IsString() @MaxLength(500) leadTime?: string;
}
export class QuoteVersionDto {
  @ApiPropertyOptional({ default: 'USD' }) @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string;
  @ApiPropertyOptional({ description: 'PDF of the quote, if uploaded' }) @IsOptional() @IsUUID() documentVersionId?: string;
  @ApiPropertyOptional({ type: QuoteTermsDto }) @IsOptional() @ValidateNested() @Type(() => QuoteTermsDto) terms?: QuoteTermsDto;
  @ApiProperty({ type: [QuoteLineDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines: QuoteLineDto[];
}
/** Customer's answer to the latest sent version (acceptance goes through POST /projects/:id/approvals). */
export class QuoteResponseDto {
  @ApiProperty({ enum: QUOTE_RESPONSES }) @IsIn(QUOTE_RESPONSES) decision: QuoteResponseDecision;
  @ApiProperty({ description: 'ID of the exact quote version answered (must be the latest)' }) @IsUUID() quoteVersionId: string;
  @ApiPropertyOptional({ description: 'Required when requesting changes: what should change' })
  @ValidateIf((o: QuoteResponseDto) => o.decision === 'changes_requested' || o.note !== undefined)
  @IsString() @MinLength(5) @MaxLength(5000) note?: string;
}

export class UpdateQuoteDto {
  @ApiProperty({ enum: QUOTE_STATUSES }) @IsIn(QUOTE_STATUSES) status: QuoteStatus;
}

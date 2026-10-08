import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { QuotesService } from './quotes.service.js';
import { QuoteResponseDto, QuoteVersionDto, UpdateQuoteDto } from './dto/quotes.dto.js';

const ID = new ParseUUIDPipe();

@ApiTags('quotes')
@ApiBearerAuth()
@Controller()
export class QuotesController {
  constructor(private readonly svc: QuotesService) {}

  @Get('projects/:id/quotes') quotes(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.svc.listQuotes(u, id); }
  @StaffOnly() @Post('projects/:id/quotes') createQuote(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: QuoteVersionDto) {
    return this.svc.createQuote(u, id, dto);
  }
  @Get('quotes/:id') quote(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.svc.getQuote(u, id); }
  @StaffOnly() @Post('quotes/:id/versions') reviseQuote(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: QuoteVersionDto) {
    return this.svc.reviseQuote(u, id, dto);
  }
  /** Customer (or staff on their behalf) declines the quote or asks for changes. */
  @Post('quotes/:id/respond') respond(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: QuoteResponseDto) {
    return this.svc.respond(u, id, dto);
  }
  @StaffOnly() @Post('quotes/:id/send') sendQuote(@CurrentUser() u: AuthUser, @Param('id', ID) id: string) { return this.svc.sendQuote(u, id); }
  @StaffOnly() @Patch('quotes/:id') quoteStatus(@CurrentUser() u: AuthUser, @Param('id', ID) id: string, @Body() dto: UpdateQuoteDto) {
    return this.svc.setQuoteStatus(u, id, dto.status);
  }
}

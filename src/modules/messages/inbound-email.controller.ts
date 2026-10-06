import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators.js';
import { MessagesService } from './messages.service.js';

/** Matches DP-INQ-2026-000123 or DP-PRJ-2026-0001 in a subject line. */
const REFERENCE = /DP-(?:INQ-\d{4}-\d{6}|PRJ-\d{4}-\d{4})/;

@ApiTags('webhooks')
@Controller('webhooks')
export class InboundEmailController {
  constructor(private readonly messages: MessagesService) {}

  /**
   * POST /api/webhooks/email-inbound – customer replied to one of our emails.
   * The reference number in the subject links the reply to the inquiry/project thread.
   *
   * TODO(resend): connect Resend inbound routing and verify its webhook signature
   * (RESEND_WEBHOOK_SECRET). Disabled until EMAIL_INBOUND_ENABLED=true.
   */
  @Public()
  @Post('email-inbound')
  @HttpCode(200)
  async inbound(@Body() body: { from?: string; subject?: string; text?: string }) {
    if (process.env.EMAIL_INBOUND_ENABLED !== 'true') return { ignored: true, reason: 'inbound email disabled' };
    const ref = body.subject?.match(REFERENCE)?.[0];
    const from = body.from?.match(/<([^>]+)>/)?.[1] ?? body.from;
    if (!ref || !from || !body.text) return { ignored: true };
    const saved = await this.messages.recordInboundReply(from, ref, body.text.slice(0, 20_000));
    return { ok: !!saved };
  }
}

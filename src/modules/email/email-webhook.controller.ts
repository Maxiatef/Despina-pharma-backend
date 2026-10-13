import { Body, Controller, Headers, HttpCode, Logger, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { EmailService } from './email.service.js';
import { Public } from '../../common/decorators/auth.decorators.js';
import type { EmailEventType } from '../../common/enums.js';
import { verifyWebhookSignature } from './webhook-signature.js';

// Resend event names → our email event types.
const EVENT_MAP: Record<string, EmailEventType> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complaint',
  'email.failed': 'failed',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
};

@ApiTags('webhooks')
@Controller('webhooks')
export class EmailWebhookController {
  private readonly logger = new Logger('EmailWebhook');

  constructor(private readonly email: EmailService) {}

  /**
   * POST /api/webhooks/email-events – Resend delivery events (set this URL in Resend → Webhooks).
   * Only signed calls are accepted (RESEND_WEBHOOK_SECRET); without the secret the endpoint refuses everything.
   */
  @Public()
  @Post('email-events')
  @HttpCode(200)
  async emailEvents(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: { type?: string; created_at?: string; data?: { email_id?: string } },
    @Headers('svix-id') id?: string,
    @Headers('svix-timestamp') timestamp?: string,
    @Headers('svix-signature') signature?: string,
  ) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Webhook not configured (RESEND_WEBHOOK_SECRET is not set)');
    const raw = req.rawBody?.toString('utf8') ?? '';
    const check = verifyWebhookSignature(secret, raw, { id, timestamp, signature });
    if (!check.ok) {
      this.logger.warn(`refused webhook call: ${check.reason}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const event = EVENT_MAP[body.type ?? ''];
    const messageId = body.data?.email_id;
    if (!event || !messageId) return { ignored: true, reason: 'event type not tracked' };
    const saved = await this.email.recordEvent(messageId, event, body as Record<string, unknown>,
      body.created_at ? new Date(body.created_at) : undefined);
    return { ok: true, matched: !!saved };
  }
}

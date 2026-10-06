import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmailService } from './email.service.js';
import { Public } from '../../common/decorators/auth.decorators.js';
import { EMAIL_EVENT_TYPES } from '../../common/enums.js';
import type { EmailEventType } from '../../common/enums.js';

// Map of provider event names (Resend style) to our email_event_type enum.
const EVENT_MAP: Record<string, EmailEventType> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complaint',
  'email.delivery_delayed': 'failed',
  'email.failed': 'failed',
  'email.opened': 'opened',
};

@ApiTags('webhooks')
@Controller('webhooks')
export class EmailWebhookController {
  constructor(private readonly email: EmailService) {}

  /**
   * POST /api/webhooks/email-events
   * TODO(resend): verify the Svix signature headers (svix-id, svix-timestamp, svix-signature)
   * with RESEND_WEBHOOK_SECRET before trusting the body. Until then this endpoint
   * rejects everything unless EMAIL_WEBHOOK_ENABLED=true.
   */
  @Public()
  @Post('email-events')
  @HttpCode(200)
  async emailEvents(@Body() body: { type?: string; created_at?: string; data?: { email_id?: string } }) {
    if (process.env.EMAIL_WEBHOOK_ENABLED !== 'true') return { ignored: true, reason: 'webhook disabled' };
    const event = EVENT_MAP[body.type ?? ''] ?? (EMAIL_EVENT_TYPES as readonly string[]).find((e) => e === body.type);
    const messageId = body.data?.email_id;
    if (!event || !messageId) return { ignored: true };
    const saved = await this.email.recordEvent(messageId, event as EmailEventType, body as Record<string, unknown>,
      body.created_at ? new Date(body.created_at) : undefined);
    return { ok: !!saved };
  }
}

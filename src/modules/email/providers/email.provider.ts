import { Injectable, Logger } from '@nestjs/common';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface SendResult {
  providerMessageId: string | null;
}

/**
 * Contract every email provider must implement.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ TODO(resend): email sending is intentionally NOT implemented yet.     │
 * │ We will plug in Resend later:                                         │
 * │   1. npm i resend                                                     │
 * │   2. Create ResendEmailProvider implementing EmailProvider using      │
 * │      new Resend(process.env.RESEND_API_KEY).emails.send({...})       │
 * │      and return { providerMessageId: data.id }.                       │
 * │   3. In email.module.ts, select it when EMAIL_PROVIDER=resend.        │
 * │   4. Verify webhook signatures (Svix) in email-webhook.controller.ts  │
 * │      with RESEND_WEBHOOK_SECRET.                                       │
 * │   5. Domain must have SPF, DKIM and DMARC set up in Resend.           │
 * └──────────────────────────────────────────────────────────────────────┘
 */
export abstract class EmailProvider {
  abstract readonly name: string;
  abstract send(email: OutgoingEmail): Promise<SendResult>;
}

/** Placeholder provider: logs the email and does not send anything. */
@Injectable()
export class NoopEmailProvider extends EmailProvider {
  readonly name = 'none';
  private readonly logger = new Logger('Email');

  async send(email: OutgoingEmail): Promise<SendResult> {
    this.logger.warn(`[EMAIL NOT SENT – no provider configured] to=${email.to} subject="${email.subject}"`);
    return { providerMessageId: null };
  }
}
